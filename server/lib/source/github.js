/**
 * Publishing what is in a GitHub repository.
 *
 * The download happens on the machine the person is sitting at, not on the
 * control plane. Two reasons, and the second is the one that matters:
 *
 *  - Everything that already works on a folder keeps working. The stack is
 *    detected, a Dockerfile is written if the app has none, and the same
 *    exclusions apply, so a `.env` committed by mistake is left behind exactly
 *    as it would be when publishing a folder.
 *  - **A token for a private repository never reaches Spryloom.** If the
 *    platform fetched the code, it would need that token, and it would then be
 *    holding a credential to somebody's entire source control. It has no
 *    business with one.
 */
import { ZipError } from './zip.js';
/**
 * Read a repository out of the ways people write one.
 *
 * Accepts what someone would paste: the address bar, the clone URL, or the
 * `owner/repo` they would type. Returns undefined when it is none of those,
 * so the caller can treat the input as something else rather than guess.
 */
export function parseRepository(input) {
    const trimmed = input.trim();
    if (trimmed === '')
        return undefined;
    // The clone URL carries its own `@`, so the host is normalised away before
    // anything is read as a branch. Otherwise `git@github.com:acme/app` splits at
    // its own separator and the repository becomes a branch called github.com.
    const normalised = trimmed
        .replace(/^https?:\/\//i, '')
        .replace(/^git@github\.com:/i, 'github.com/')
        .replace(/^www\.github\.com\//i, 'github.com/')
        .replace(/^github\.com\//i, '');
    // `owner/repo@ref` and `owner/repo#ref` both read naturally; take either.
    const [locator, ref] = splitOnce(normalised, /[@#]/);
    const withoutScheme = locator
        .replace(/\.git$/i, '')
        .replace(/\/+$/, '');
    // Anything left with a host in it is not GitHub, and this is not the place to
    // pretend otherwise.
    if (withoutScheme.includes('://') || /^[^/]*\.[^/]*\//.test(withoutScheme))
        return undefined;
    const parts = withoutScheme.split('/').filter((part) => part !== '');
    if (parts.length < 2)
        return undefined;
    const [owner, repo, ...rest] = parts;
    if (owner === undefined || repo === undefined)
        return undefined;
    if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo))
        return undefined;
    // A pasted address-bar URL carries `/tree/<branch>[/<folder>]` after the
    // repository. Anything else after it is a folder, written the way a person
    // would type one: `github.com/acme/tools/apps/status@main`.
    const fromTree = rest[0] === 'tree' && rest[1] !== undefined;
    const branchFromUrl = fromTree ? rest.slice(1).join('/') : undefined;
    const folderSegments = fromTree ? [] : rest;
    // `..` would climb out of the repository, and `.` means nothing; neither is a
    // folder anyone links to, so the input is not a repository at all.
    const climbs = (segment) => segment === '.' || segment === '..';
    if (folderSegments.some(climbs) || (fromTree && rest.slice(1).some(climbs)))
        return undefined;
    const chosen = ref ?? branchFromUrl;
    const folder = folderSegments.join('/');
    return {
        owner,
        repo,
        ...(chosen !== undefined && chosen !== '' && { ref: chosen }),
        ...(folder !== '' && { folder }),
        // Only the URL's own ref can hide a folder. An `@ref` the person typed is
        // a ref and nothing else.
        ...(ref === undefined && fromTree && rest.length > 2 && { refMayHoldFolder: true }),
    };
}
function splitOnce(value, separator) {
    const at = value.search(separator);
    if (at < 0)
        return [value, undefined];
    return [value.slice(0, at), value.slice(at + 1)];
}
/** How the reference reads back to a person. */
export function describeRepository(reference) {
    const where = `github.com/${reference.owner}/${reference.repo}${reference.folder === undefined ? '' : `/${reference.folder}`}`;
    // Not yet settled into a branch and a folder: read it back as it was written.
    if (reference.refMayHoldFolder === true && reference.ref !== undefined)
        return `${where}/tree/${reference.ref}`;
    return reference.ref === undefined ? where : `${where} at ${reference.ref}`;
}
export class RepositoryError extends Error {
    hint;
    /** GitHub's answer, when GitHub gave one. */
    status;
    constructor(message, hint, status) {
        super(message);
        this.name = 'RepositoryError';
        this.hint = hint;
        this.status = status;
    }
}
/** How long to wait for GitHub before giving up. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;
/**
 * Download a repository as a zip.
 *
 * GitHub's zipball endpoint is used rather than git, so this needs no git on the
 * machine and fetches one commit instead of a history. The response is a zip
 * whose entries all sit under one generated directory, which the caller strips.
 */
export async function downloadRepository(reference, options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const path = `${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}`;
    const url = reference.ref === undefined
        ? `https://api.github.com/repos/${path}/zipball`
        : `https://api.github.com/repos/${path}/zipball/${encodeURIComponent(reference.ref)}`;
    let response;
    try {
        response = await fetchImpl(url, {
            headers: {
                accept: 'application/vnd.github+json',
                'user-agent': 'spryloom',
                ...(options.token !== undefined && options.token !== ''
                    ? { authorization: `Bearer ${options.token}` }
                    : {}),
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
        });
    }
    catch (cause) {
        throw new RepositoryError(`GitHub could not be reached to download ${describeRepository(reference)}.`, 'Check the connection and try again. Nothing was published.');
    }
    if (!response.ok)
        throw explainGitHub(response.status, reference, options.token);
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.byteLength === 0) {
        throw new RepositoryError(`${describeRepository(reference)} came back empty.`, 'Check that the branch has something on it.');
    }
    return archive;
}
/**
 * Download a repository, settling where the branch ends and the folder begins.
 *
 * An address-bar URL such as `…/tree/main/examples/app` does not say which
 * part is the branch. Git refuses a branch `main` beside a branch
 * `main/examples`, because one would be a file and the other a folder of the
 * same name, so at most one way of splitting it names a branch. The shortest
 * branch is tried first, because that is nearly always `main`; a 404 moves on
 * to the next. The last attempt is the whole thing as a branch, which is what
 * the URL meant before folders were read from it.
 *
 * Returns the reference as it was settled, so what is described and where the
 * folder is cut from are both right.
 */
export async function downloadRepositoryAt(reference, options = {}) {
    if (reference.refMayHoldFolder !== true || reference.ref === undefined) {
        return { reference, archive: await downloadRepository(reference, options) };
    }
    const segments = reference.ref.split('/');
    for (let take = 1; take < segments.length; take += 1) {
        const candidate = {
            owner: reference.owner,
            repo: reference.repo,
            ref: segments.slice(0, take).join('/'),
            folder: [...segments.slice(take), ...(reference.folder === undefined ? [] : [reference.folder])].join('/'),
        };
        try {
            return { reference: candidate, archive: await downloadRepository(candidate, options) };
        }
        catch (error) {
            if (!(error instanceof RepositoryError) || error.status !== 404)
                throw error;
        }
    }
    const whole = {
        owner: reference.owner,
        repo: reference.repo,
        ref: reference.ref,
        ...(reference.folder !== undefined && { folder: reference.folder }),
    };
    try {
        return { reference: whole, archive: await downloadRepository(whole, options) };
    }
    catch (error) {
        // Every way of reading it was refused. Say so about what the person wrote,
        // with the hint that names the folder as one of the things to check.
        if (error instanceof RepositoryError && error.status === 404) {
            throw explainGitHub(404, reference, options.token);
        }
        throw error;
    }
}
/**
 * Say what GitHub's answer means.
 *
 * A 404 is the interesting one: GitHub says that for a repository that does not
 * exist and for a private one you cannot see, on purpose, so this cannot claim
 * to know which it was.
 */
function explainGitHub(status, reference, token) {
    const where = describeRepository(reference);
    const signedIn = token !== undefined && token !== '';
    if (status === 404) {
        const check = reference.folder !== undefined || reference.refMayHoldFolder === true
            ? 'Check the name, the branch and the folder.'
            : 'Check the name and the branch.';
        return new RepositoryError(`${where} could not be found.`, signedIn
            ? `${check} If it is private, the token needs access to it.`
            : `${check} If it is private, set GITHUB_TOKEN to a token that can read it.`, status);
    }
    if (status === 401 || status === 403) {
        return new RepositoryError(signedIn
            ? `GitHub refused the token when reading ${where}.`
            : `${where} needs a token to read.`, signedIn
            ? 'The token may have expired, or may not cover this repository.'
            : 'Set GITHUB_TOKEN to a token that can read it, then publish again.');
    }
    if (status === 429) {
        return new RepositoryError('GitHub is rate-limiting this machine.', 'Wait a few minutes, or set GITHUB_TOKEN, which raises the limit considerably.');
    }
    return new RepositoryError(`GitHub answered ${status} when downloading ${where}.`, 'Try again in a moment. Nothing was published.');
}
/**
 * The single directory GitHub wraps a download in.
 *
 * A zipball holds `owner-repo-<commit>/…` and nothing beside it, so publishing
 * it as it stands would put the app one level down from where it says it is.
 * Returns undefined when the entries do not share one root, in which case there
 * is nothing to strip.
 */
export function commonRoot(paths) {
    const roots = new Set();
    for (const path of paths) {
        const first = path.split('/')[0];
        if (first === undefined || first === '')
            return undefined;
        roots.add(first);
        if (roots.size > 1)
            return undefined;
    }
    const [only] = [...roots];
    // A single file at the top is not a wrapping directory.
    return only !== undefined && paths.some((path) => path.startsWith(`${only}/`)) ? only : undefined;
}
export { ZipError };
//# sourceMappingURL=github.js.map