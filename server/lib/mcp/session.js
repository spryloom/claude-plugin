/**
 * Which Spryloom the agent talks to, and as whom.
 *
 * The agent server acts as a person. Getting this wrong means acting as the
 * wrong one, so it is its own module with its own tests rather than a few lines
 * in a binary.
 *
 * The token is never read from a command line. Anything on a command line is in
 * the process list, readable by every other process on the machine. It comes
 * from the file the terminal already writes, with the same environment override
 * the terminal honours, so signing in once covers both.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** Where the terminal keeps its session. The same file `spry login` writes. */
export function sessionPath(env = process.env) {
    const configured = env['SPRYLOOM_CONFIG'];
    if (configured !== undefined && configured !== '')
        return configured;
    const base = env['XDG_CONFIG_HOME'];
    return base !== undefined && base !== ''
        ? join(base, 'spryloom', 'session.json')
        : join(homedir(), '.config', 'spryloom', 'session.json');
}
/** Which Spryloom to talk to. */
export function baseUrlFrom(env = process.env) {
    const configured = env['SPRYLOOM_URL'];
    return configured !== undefined && configured !== '' ? configured : 'https://app.spryloom.com';
}
/**
 * The token for this platform, or nothing.
 *
 * A missing or unreadable file means nobody is signed in, which is an ordinary
 * state rather than an error. One file holds one token per platform, so working
 * against staging does not sign you out of production.
 */
export async function tokenFor(baseUrl, env = process.env) {
    const fromEnv = env['SPRYLOOM_TOKEN'];
    if (fromEnv !== undefined && fromEnv !== '')
        return fromEnv;
    try {
        const parsed = JSON.parse(await readFile(sessionPath(env), 'utf8'));
        if (parsed.version !== 1 || typeof parsed.sessions !== 'object' || parsed.sessions === null) {
            return undefined;
        }
        const token = parsed.sessions[baseUrl]?.token;
        return token === undefined || token === '' ? undefined : token;
    }
    catch {
        return undefined;
    }
}
/**
 * Keep a session, for this platform, beside any for others.
 *
 * The one writer of the file, used by `spry login` and by signing in from the
 * agent, so the two cannot disagree about its shape. Readable only by its owner:
 * anyone who can read it can act as the person it belongs to.
 */
export async function saveSession(session, env = process.env) {
    const path = sessionPath(env);
    await mkdir(dirname(path), { recursive: true });
    let sessions = {};
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (parsed.version === 1 && typeof parsed.sessions === 'object' && parsed.sessions !== null) {
            sessions = parsed.sessions;
        }
    }
    catch {
        // Nothing kept yet, or nothing readable: start a new file.
    }
    const next = {
        version: 1,
        sessions: {
            ...sessions,
            [session.baseUrl]: { token: session.token, email: session.email, workspace: session.workspace },
        },
    };
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    // Set again after writing, because an existing file keeps its old mode.
    await chmod(path, 0o600).catch(() => undefined);
}
//# sourceMappingURL=session.js.map