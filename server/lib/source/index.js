/**
 * Where the app being published comes from.
 *
 * Three ways in: a folder, a zip of one, and a GitHub repository. They all end
 * as the same thing, a folder on this machine, and everything downstream —
 * detection, the manifest, the exclusions, the upload — sees only that.
 *
 * That is the point of this module. The control plane accepts exactly one kind
 * of input, and it is the least trusted thing it handles (see
 * `@spryloom/api`'s archive). Adding two more ways for bytes to arrive there
 * would mean two more things to get right in the place where getting it wrong
 * is worst. Here, on the machine of the person publishing, a zip is just a zip.
 */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { RepositoryError, describeRepository, downloadRepositoryAt, commonRoot, parseRepository, } from './github.js';
import { ZipError, readZip } from './zip.js';
import { PAGE_FILE, pageFolderFromFile } from './page-file.js';
export { MAX_ENTRIES, MAX_EXPANDED_BYTES, MAX_ZIP_BYTES, ZipError, entryIsSafe, readZip, } from './zip.js';
export { DOWNLOAD_TIMEOUT_MS, RepositoryError, commonRoot, describeRepository, downloadRepository, downloadRepositoryAt, parseRepository, } from './github.js';
export { PAGE_FILE, PageFileError, localReferences, pageFolderFromFile, renderMarkdownPage, titleOf } from './page-file.js';
/**
 * Work out what someone meant.
 *
 * A path that ends `.zip` is a zip; anything GitHub-shaped is a repository;
 * everything else is a folder, which is what it has always been. Deciding by
 * shape rather than by a flag means `spry publish` keeps taking one argument.
 */
export function parseSource(input) {
    const trimmed = input.trim();
    if (/\.zip$/i.test(trimmed.replace(/[@#][^/\\]*$/, ''))) {
        return { kind: 'zip', path: trimmed };
    }
    // Only strings that name GitHub, never a bare `something/other` that is far
    // more likely to be a relative path someone typed.
    if (/^(https?:\/\/)?(www\.)?github\.com[/:]/i.test(trimmed) || /^git@github\.com:/i.test(trimmed)) {
        const reference = parseRepository(trimmed);
        if (reference !== undefined)
            return { kind: 'repository', reference };
    }
    // A single page file (D105). A folder that happens to be called
    // `site.html` is still a folder: resolving checks which it is.
    if (PAGE_FILE.test(trimmed))
        return { kind: 'page', path: trimmed };
    return { kind: 'folder', path: trimmed };
}
/** How a source reads back to a person, for a line that says what is happening. */
export function describeSource(source) {
    switch (source.kind) {
        case 'folder':
        case 'page':
            return source.path;
        case 'zip':
            return source.path;
        case 'repository':
            return describeRepository(source.reference);
    }
}
/**
 * Turn a source into a folder.
 *
 * The caller disposes of it afterwards, whatever it was: for a folder that does
 * nothing, and for the other two it removes what was written.
 */
export async function resolveSource(source, options = {}) {
    switch (source.kind) {
        case 'folder': {
            const root = resolvePath(source.path);
            return {
                root,
                describe: root,
                suggestedName: basename(root),
                temporary: false,
                dispose: async () => undefined,
            };
        }
        case 'page': {
            const path = resolvePath(source.path);
            // Named like a page file but a directory: publish it as the folder it is.
            if ((await stat(path).catch(() => undefined))?.isDirectory() === true) {
                return { root: path, describe: path, suggestedName: basename(path), temporary: false, dispose: async () => undefined };
            }
            const page = await pageFolderFromFile(path);
            return {
                root: page.root,
                describe: path,
                suggestedName: page.suggestedName,
                temporary: true,
                singleFile: true,
                notes: page.notes,
                ...(page.title !== undefined && { suggestedDescription: page.title }),
                dispose: page.dispose,
            };
        }
        case 'zip': {
            const path = resolvePath(source.path);
            const read = options.readFile ?? (async (at) => (await import('node:fs/promises')).readFile(at));
            let archive;
            try {
                archive = await read(path);
            }
            catch {
                throw new ZipError('not_a_zip', `There is no file at ${path}.`, 'Check the path, or publish from the folder itself.');
            }
            const entries = readZip(archive);
            const wrapper = stripWrapper(entries);
            const root = await write(entries, wrapper);
            return {
                root,
                describe: path,
                // The folder the zip wraps, when it wraps one, and otherwise the zip's
                // own name. Both are what the person would have called it.
                suggestedName: wrapper ?? basename(path).replace(/\.zip$/i, ''),
                temporary: true,
                dispose: async () => rm(root, { recursive: true, force: true }),
            };
        }
        case 'repository': {
            const { reference, archive } = await downloadRepositoryAt(source.reference, options);
            const entries = readZip(archive);
            // A zipball always wraps everything in one generated directory named for
            // the commit. Publishing it as it stands would put the app one level below
            // where the manifest says it is.
            const wrapper = commonRoot(entries.map((entry) => entry.path));
            // One folder of the repository, such as one starter of several, is
            // published as though it were the whole of it.
            const strip = reference.folder === undefined
                ? wrapper
                : [...(wrapper === undefined ? [] : [wrapper]), reference.folder].join('/');
            const kept = reference.folder === undefined
                ? entries
                : entries.filter((entry) => entry.path === strip || entry.path.startsWith(`${strip}/`));
            if (reference.folder !== undefined && !kept.some((entry) => !entry.isDirectory)) {
                const { folder, ...repository } = reference;
                throw new RepositoryError(`There is no folder ${folder} in ${describeRepository(repository)}.`, 'Check the folder. It is case-sensitive, and is the path shown above the file list on GitHub.');
            }
            const root = await write(kept, strip);
            return {
                root,
                describe: describeRepository(reference),
                // A starter in a repository of several is called what its folder is called.
                suggestedName: reference.folder?.split('/').at(-1) ?? reference.repo,
                temporary: true,
                dispose: async () => rm(root, { recursive: true, force: true }),
            };
        }
    }
}
/**
 * The single directory an archive wraps everything in, when it has one.
 *
 * Zipping a folder usually produces `myapp/…`, and publishing that would nest
 * the app inside a directory nobody asked for. One shared root is stripped; two
 * or more roots means the zip is of the contents, and nothing is stripped.
 */
export function stripWrapper(entries) {
    return commonRoot(entries.filter((entry) => !entry.isDirectory).map((entry) => entry.path));
}
/** Write entries into a fresh directory, dropping `strip` from the front of each. */
async function write(entries, strip) {
    const root = await mkdtemp(join(tmpdir(), 'spryloom-source-'));
    try {
        for (const entry of entries) {
            // The wrapper's own entry has had its trailing slash removed by now, so it
            // does not match the `myapp/` prefix and would be recreated inside the
            // folder it is being stripped from.
            if (strip !== undefined && entry.path === strip)
                continue;
            const relative = strip === undefined ? entry.path : trimPrefix(entry.path, `${strip}/`);
            if (relative === '')
                continue;
            const target = join(root, relative);
            if (entry.isDirectory) {
                await mkdir(target, { recursive: true });
                continue;
            }
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, entry.contents, {
                // Only the execute bit is carried over, and only when the archive
                // recorded one. Everything else is ours to decide, and a file that
                // arrives group-writable should not stay that way.
                mode: entry.mode !== undefined && (entry.mode & 0o111) !== 0 ? 0o755 : 0o644,
            });
        }
        // An archive of nothing is a mistake worth naming, rather than a build that
        // fails later for a reason nobody can trace back to here.
        const files = entries.filter((entry) => !entry.isDirectory).length;
        if (files === 0) {
            throw new ZipError('empty', 'That archive holds no files.', 'Check that the zip is of the folder holding the app.');
        }
        await stat(root);
        return root;
    }
    catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
}
function trimPrefix(value, prefix) {
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
export { RepositoryError as GitHubError };
//# sourceMappingURL=index.js.map