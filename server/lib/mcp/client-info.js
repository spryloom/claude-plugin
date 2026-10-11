/**
 * Who is running `spry`, as far as this process can tell (D126).
 *
 * Read from things the process already has: which marker variables coding
 * agents set in the shells they run, the path this file was installed at, and,
 * through MCP, the name the agent introduced itself with. Only names from a
 * fixed list leave the machine, never a value or a path, and nothing about the
 * project or the person.
 *
 * The markers are what each agent was seen or documented to set in October
 * 2026. Claude Code's were checked directly. Codex's and Cursor's are reported
 * by their communities and have changed between versions, which is why the
 * names present are sent as well as the guess: a new marker shows up in the
 * data before the guess learns it.
 */
import { realpathSync } from 'node:fs';
import { formatClient } from '../protocol/index.js';
/** Variables whose presence says something, by name. Values are never read except where noted. */
const MARKERS = [
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'CODEX_THREAD_ID',
    'CODEX_SANDBOX',
    'CODEX_SANDBOX_NETWORK_DISABLED',
    'CURSOR_AGENT',
    'CURSOR_TRACE_ID',
    'GEMINI_CLI',
    'AGENT',
    'CI',
];
/** Which agent, from the markers. The first rule that matches wins. */
export function agentFrom(env) {
    const set = (name) => env[name] !== undefined && env[name] !== '';
    if (set('CLAUDECODE')) {
        // Claude Code's entry point is a short word it chose (cli, sdk-ts, claude-desktop…).
        const entry = env['CLAUDE_CODE_ENTRYPOINT'];
        return { agent: 'claude-code', ...(entry !== undefined && /^[a-z0-9._-]{1,32}$/i.test(entry) && { entry: entry.toLowerCase() }) };
    }
    if (set('CODEX_THREAD_ID') || set('CODEX_SANDBOX') || set('CODEX_SANDBOX_NETWORK_DISABLED'))
        return { agent: 'codex' };
    if (set('CURSOR_AGENT'))
        return { agent: 'cursor' };
    if (set('GEMINI_CLI'))
        return { agent: 'gemini-cli' };
    // A convention some agents follow: AGENT=<name>.
    const named = env['AGENT'];
    if (named !== undefined && /^[a-z][a-z0-9-]{1,24}$/i.test(named))
        return { agent: named.toLowerCase() };
    if (set('CI'))
        return { agent: 'ci' };
    return { agent: 'none' };
}
/** How this copy of spry was installed, from where it is running. */
export function installFrom(path) {
    const p = path.replaceAll('\\', '/');
    if (p.includes('/.claude/plugins/'))
        return 'claude-plugin';
    if (p.includes('/.cursor/'))
        return 'cursor-plugin';
    if (p.includes('/.codex/'))
        return 'codex-plugin';
    if (p.includes('/_npx/'))
        return 'npx';
    if (p.includes('/dlx-') || p.includes('/pnpm/dlx/') || p.includes('/.pnpm-store/') || p.includes('/pnpm/store/'))
        return 'pnpm-dlx';
    if (p.includes('/bunx-') || p.includes('/.bun/install/cache/'))
        return 'bunx';
    if (/\/lib\/node_modules\/spryloom\//.test(p) || /\/(?:pnpm|\.volta|\.nvm|fnm)\/.*\/spryloom\//.test(p))
        return 'npm-global';
    if (p.includes('/node_modules/spryloom/'))
        return 'npm-local';
    if (/\/packages\/(?:cli|mcp)\//.test(p))
        return 'source';
    return 'unknown';
}
let via = 'cli';
let mcpClient;
/** Called once when `spry mcp` starts: requests from here on came through an agent's tools. */
export function servingMcp() {
    via = 'mcp';
}
/** The name and version the MCP client introduced itself with. */
export function mcpClientIs(info) {
    if (info?.name === undefined)
        return;
    mcpClient = info.version === undefined ? info.name : `${info.name}/${info.version}`;
}
/** The whole description, from this process. Worked out once; only the MCP name changes later. */
let cached;
export function describeThisClient(version, env = process.env, entryPath = process.argv[1]) {
    if (cached === undefined) {
        let path = entryPath ?? '';
        try {
            path = realpathSync(path);
        }
        catch {
            // Not a file we can resolve: keep the path as given.
        }
        const { agent, entry } = agentFrom(env);
        const marks = MARKERS.filter((name) => env[name] !== undefined && env[name] !== '');
        cached = {
            agent,
            ...(entry !== undefined && { entry }),
            install: installFrom(path),
            os: process.platform,
            ...(marks.length > 0 && { marks }),
        };
    }
    return { version, via, ...cached, ...(mcpClient !== undefined && { mcp: mcpClient }) };
}
/** The `x-spryloom-client` header for this process. */
export function clientHeader(version) {
    return formatClient(describeThisClient(version));
}
/** For tests: forget what was worked out. */
export function resetClientInfo() {
    cached = undefined;
    via = 'cli';
    mcpClient = undefined;
}
//# sourceMappingURL=client-info.js.map