/**
 * What `spry` says about itself on every request (D126).
 *
 * The `x-spryloom-client` header was `spry/<version>` alone, there so the API
 * could turn away a client too old for it (D99). It now also says, in words
 * from a fixed vocabulary, how the person is using Spryloom:
 *
 *   spry/0.1.18 (via=cli; agent=claude-code; entry=cli; install=npx; os=darwin)
 *   spry/0.1.18 (via=mcp; agent=claude-code; install=claude-plugin; mcp=claude-code/2.1.3; os=darwin)
 *
 * Nothing here is content, a path, a name or a value from the person's
 * environment. `marks` lists which of a fixed set of variables were present,
 * by name only, so an agent we do not recognise yet can be told apart later.
 * The version prefix is unchanged, so an API that only reads the version
 * still reads it.
 */
/** One word: lower-case letters, digits and `._-/`, at most 48 characters. */
export function clientWord(value) {
    const word = value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 48);
    return /^[a-z0-9][a-z0-9._/-]*$/.test(word) ? word : undefined;
}
const FIELDS = ['via', 'agent', 'entry', 'install', 'mcp', 'os', 'marks'];
export function formatClient(description) {
    const parts = [];
    for (const field of FIELDS) {
        const value = description[field];
        if (value === undefined)
            continue;
        const text = Array.isArray(value) ? value.map((v) => clientWord(String(v))).filter((v) => v !== undefined).join(',') : clientWord(String(value));
        if (text !== undefined && text !== '')
            parts.push(`${field}=${text}`);
    }
    return `spry/${description.version}${parts.length === 0 ? '' : ` (${parts.join('; ')})`}`;
}
/** The header read back. Anything outside the vocabulary is dropped, never stored. */
export function parseClient(header) {
    const match = /^spry\/(\d+\.\d+\.\d+(?:-[0-9a-z.]+)?)(?:\s+\((.*)\))?\s*$/i.exec((header ?? '').slice(0, 400));
    if (match === null)
        return undefined;
    const found = { version: match[1] };
    for (const pair of (match[2] ?? '').split(';')) {
        const at = pair.indexOf('=');
        if (at <= 0)
            continue;
        const key = pair.slice(0, at).trim().toLowerCase();
        const raw = pair.slice(at + 1).trim();
        if (!FIELDS.includes(key))
            continue;
        if (key === 'marks') {
            const marks = raw.split(',').map((m) => clientWord(m)).filter((m) => m !== undefined).slice(0, 12);
            if (marks.length > 0)
                found['marks'] = marks;
            continue;
        }
        const word = clientWord(raw);
        if (word === undefined)
            continue;
        if (key === 'via' && word !== 'cli' && word !== 'mcp')
            continue;
        found[key] = word;
    }
    return found;
}
/** A short, readable summary: "Claude Code · plugin · MCP". */
export function describeClient(description) {
    if (description === undefined)
        return 'unknown client';
    const agent = description.agent === undefined || description.agent === 'none'
        ? description.mcp !== undefined
            ? (description.mcp.split('/')[0] ?? description.mcp)
            : 'no agent'
        : (AGENT_NAMES[description.agent] ?? description.agent);
    const install = description.install === undefined ? undefined : (INSTALL_NAMES[description.install] ?? description.install);
    const via = description.via === 'mcp' ? 'MCP' : description.via === 'cli' ? 'terminal' : undefined;
    return [agent, install, via, `spry ${description.version}`].filter((p) => p !== undefined).join(' · ');
}
export const AGENT_NAMES = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    'gemini-cli': 'Gemini CLI',
    ci: 'CI',
    none: 'no agent',
};
export const INSTALL_NAMES = {
    'claude-plugin': 'Claude plugin',
    'cursor-plugin': 'Cursor plugin',
    'codex-plugin': 'Codex plugin',
    npx: 'npx',
    'pnpm-dlx': 'pnpm dlx',
    bunx: 'bunx',
    'npm-global': 'npm global',
    'npm-local': 'npm in a project',
    source: 'from source',
    unknown: 'unknown install',
};
//# sourceMappingURL=client.js.map