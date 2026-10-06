/**
 * Reading a zip file.
 *
 * Written here rather than shelled out to `unzip`, for the same reason the tar
 * that leaves a machine is written by hand: this is the code that decides what
 * a zip is allowed to put on someone's disk, and that decision should not
 * depend on which `unzip` happens to be installed, or on whether it was built
 * with the flags we assumed.
 *
 * A zip arrives from outside, so every one of these is checked before a single
 * byte is written:
 *
 *  - **A path that escapes.** `../../etc/passwd`, an absolute path, a Windows
 *    drive letter. Every entry is read from the central directory first and the
 *    archive is refused whole rather than partly unpacked.
 *  - **A symbolic link.** A link is a path that is followed later, which is a
 *    way out of the folder after the checks have finished. They are refused,
 *    not skipped, because an app that needs one is an app we cannot publish
 *    faithfully and should say so.
 *  - **A size that does not stop.** A few kilobytes can inflate into gigabytes,
 *    so the total is counted from the central directory before anything is
 *    inflated, and again as it is written.
 *  - **Encryption.** An entry we cannot read is an entry we cannot check.
 *
 * What it does not do is implement all of zip. Only stored and deflated entries
 * are understood, which is everything anyone's zip of a folder contains.
 */
import { crc32, inflateRawSync } from 'node:zlib';
/** Largest zip accepted, as it arrives. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
/** Largest total once expanded. */
export const MAX_EXPANDED_BYTES = 500 * 1024 * 1024;
/** Most entries accepted, so a listing alone cannot take the process down. */
export const MAX_ENTRIES = 20_000;
export class ZipError extends Error {
    reason;
    hint;
    constructor(reason, message, hint) {
        super(message);
        this.name = 'ZipError';
        this.reason = reason;
        this.hint = hint;
    }
}
/**
 * Is this entry name safe to write?
 *
 * Exported so the rule can be tested directly rather than only through a real
 * archive, because the cases that matter are the ones nobody creates by hand.
 * The same rule the tar unpacker applies, deliberately: two ways in should not
 * mean two definitions of safe.
 */
export function entryIsSafe(name) {
    if (name === '' || name === '.')
        return true;
    if (name.startsWith('/') || name.startsWith('\\'))
        return false;
    if (/^[A-Za-z]:/.test(name))
        return false;
    // A backslash is a separator on the machine this may be written to, so a name
    // is judged on both.
    const parts = name.split(/[/\\]/);
    return !parts.includes('..');
}
const SIGNATURE = {
    endOfCentralDirectory: 0x06054b50,
    centralFileHeader: 0x02014b50,
    localFileHeader: 0x04034b50,
    zip64Locator: 0x07064b50,
};
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
/**
 * Read every entry from a zip.
 *
 * Returns them in the order the archive lists them. Nothing is written to disk
 * here; the caller decides where these go, which keeps the checks and the
 * writing in one place each.
 */
export function readZip(archive) {
    if (archive.byteLength === 0) {
        throw new ZipError('empty', 'That zip file is empty.', 'Check the file and try again.');
    }
    if (archive.byteLength > MAX_ZIP_BYTES) {
        throw new ZipError('too_large', `That zip is ${Math.round(archive.byteLength / 1024 / 1024)} MB, which is more than Spryloom accepts.`, 'Remove what the app does not need to run, such as node_modules or build output.');
    }
    const directory = findCentralDirectory(archive);
    const headers = readCentralDirectory(archive, directory);
    // Everything is checked before anything is inflated, so an archive that would
    // misbehave is refused whole rather than half-expanded and then cleaned up.
    let expanded = 0;
    for (const header of headers) {
        if (!entryIsSafe(header.path)) {
            throw new ZipError(header.path.startsWith('/') || /^[A-Za-z]:/.test(header.path)
                ? 'absolute_path'
                : 'path_escapes', `That zip contains a file path that points outside the folder: ${header.path}`, 'This usually means the zip was not made from a plain folder. Zip the folder itself and try again.');
        }
        if (header.isSymlink) {
            throw new ZipError('symbolic_link', `That zip contains a symbolic link: ${header.path}`, 'Spryloom publishes what is in the folder, and a link points somewhere else. Replace it with the file it points to.');
        }
        if (header.isEncrypted) {
            throw new ZipError('encrypted', 'That zip is password-protected, so Spryloom cannot read what is in it.', 'Publish from an unprotected zip, or from the folder itself.');
        }
        if (header.method !== 0 && header.method !== 8) {
            throw new ZipError('unsupported_compression', `That zip uses a compression method Spryloom does not read (${header.method}).`, 'Zip the folder again with the usual settings, or publish from the folder itself.');
        }
        expanded += header.uncompressedSize;
        if (expanded > MAX_EXPANDED_BYTES) {
            throw new ZipError('too_large_expanded', 'That zip expands to more than Spryloom accepts.', 'Check for large files that the app does not need in order to run.');
        }
    }
    return headers.map((header) => readEntry(archive, header));
}
/** Where the listing starts, and how many entries it holds. */
function findCentralDirectory(archive) {
    // The record sits at the end, after a comment of up to 65535 bytes, so it is
    // found by scanning backwards rather than by assuming where it is.
    const earliest = Math.max(0, archive.byteLength - 22 - 0xffff);
    for (let at = archive.byteLength - 22; at >= earliest; at -= 1) {
        if (archive.readUInt32LE(at) !== SIGNATURE.endOfCentralDirectory)
            continue;
        const entries = archive.readUInt16LE(at + 10);
        const offset = archive.readUInt32LE(at + 16);
        // Zip64 uses these values as markers meaning "look elsewhere". Rather than
        // read half of zip64 and get it subtly wrong, this says so plainly.
        if (entries === 0xffff || offset === 0xffffffff) {
            throw new ZipError('too_many_entries', 'That zip is in a format Spryloom does not read (zip64).', 'It usually means the archive is very large. Publish from the folder itself.');
        }
        if (entries > MAX_ENTRIES) {
            throw new ZipError('too_many_entries', `That zip holds ${entries} files, which is more than Spryloom accepts.`, 'Remove what the app does not need to run, such as node_modules or build output.');
        }
        if (offset >= archive.byteLength) {
            throw new ZipError('corrupt', 'That zip file is damaged.', 'Make the zip again and try once more.');
        }
        return { offset, entries };
    }
    throw new ZipError('not_a_zip', 'That file is not a zip.', 'Publish from a zip of the folder, or from the folder itself.');
}
function readCentralDirectory(archive, directory) {
    const headers = [];
    let at = directory.offset;
    for (let index = 0; index < directory.entries; index += 1) {
        if (at + 46 > archive.byteLength || archive.readUInt32LE(at) !== SIGNATURE.centralFileHeader) {
            throw new ZipError('corrupt', 'That zip file is damaged.', 'Make the zip again and try once more.');
        }
        const flags = archive.readUInt16LE(at + 8);
        const method = archive.readUInt16LE(at + 10);
        const crc = archive.readUInt32LE(at + 16);
        const compressedSize = archive.readUInt32LE(at + 20);
        const uncompressedSize = archive.readUInt32LE(at + 24);
        const nameLength = archive.readUInt16LE(at + 28);
        const extraLength = archive.readUInt16LE(at + 30);
        const commentLength = archive.readUInt16LE(at + 32);
        const externalAttributes = archive.readUInt32LE(at + 38);
        const localOffset = archive.readUInt32LE(at + 42);
        const nameEnd = at + 46 + nameLength;
        if (nameEnd > archive.byteLength) {
            throw new ZipError('corrupt', 'That zip file is damaged.', 'Make the zip again and try once more.');
        }
        // Names are UTF-8 when the archive says so, and otherwise are read as UTF-8
        // anyway: the alternative is a code page nobody can identify from here.
        const path = archive.subarray(at + 46, nameEnd).toString('utf8').replace(/\\/g, '/');
        // The high sixteen bits are the Unix mode, when the archive came from a
        // system that has one. Zero means it did not, not that the file has no mode.
        const unixMode = (externalAttributes >>> 16) & 0xffff;
        const isSymlink = unixMode !== 0 && (unixMode & S_IFMT) === S_IFLNK;
        headers.push({
            path,
            method,
            compressedSize,
            uncompressedSize,
            crc,
            localOffset,
            isDirectory: path.endsWith('/'),
            isSymlink,
            isEncrypted: (flags & 0x1) !== 0,
            mode: unixMode === 0 ? undefined : unixMode & 0o7777,
        });
        at = nameEnd + extraLength + commentLength;
    }
    return headers;
}
function readEntry(archive, header) {
    if (header.isDirectory) {
        return {
            path: header.path.replace(/\/+$/, ''),
            isDirectory: true,
            contents: Buffer.alloc(0),
            ...(header.mode !== undefined && { mode: header.mode }),
        };
    }
    const at = header.localOffset;
    if (at + 30 > archive.byteLength || archive.readUInt32LE(at) !== SIGNATURE.localFileHeader) {
        throw new ZipError('corrupt', 'That zip file is damaged.', 'Make the zip again and try once more.');
    }
    // The local header repeats the name and extra fields, and their lengths can
    // differ from the listing's, so they are read from here rather than reused.
    const nameLength = archive.readUInt16LE(at + 26);
    const extraLength = archive.readUInt16LE(at + 28);
    const start = at + 30 + nameLength + extraLength;
    const end = start + header.compressedSize;
    if (end > archive.byteLength) {
        throw new ZipError('corrupt', 'That zip file is damaged.', 'Make the zip again and try once more.');
    }
    const raw = archive.subarray(start, end);
    let contents;
    try {
        contents = header.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    }
    catch {
        throw new ZipError('corrupt', 'That zip file is damaged.', 'Make the zip again and try once more.');
    }
    // The size and checksum are both recorded, so a file that arrives wrong is
    // caught here rather than becoming a build failure nobody can explain.
    if (contents.byteLength !== header.uncompressedSize || crc32(contents) !== header.crc) {
        throw new ZipError('corrupt', `That zip file is damaged: ${header.path} did not survive being read.`, 'Make the zip again and try once more.');
    }
    return {
        path: header.path,
        isDirectory: false,
        contents,
        ...(header.mode !== undefined && { mode: header.mode }),
    };
}
//# sourceMappingURL=zip.js.map