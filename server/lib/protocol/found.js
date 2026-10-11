/**
 * The answers to "how did you find Spryloom?", asked once after a first
 * sign-in (D127). Here so the API that asks and the tools that read the
 * answers say the same words.
 */
export const FOUND_VIA = {
    'claude-plugin': 'The Claude Code plugin directory',
    'agent-suggested': 'My AI agent suggested it',
    'mcp-directory': 'An MCP directory or registry',
    invited: 'I was invited to an app on Spryloom',
    coworker: 'A coworker or friend told me',
    search: 'A web search',
    github: 'GitHub',
    social: 'Social media, a newsletter or a community',
    other: 'Somewhere else',
};
export const isFoundVia = (value) => value === 'skipped' || Object.hasOwn(FOUND_VIA, value);
/** An answer in words; a skip reads as one. */
export const foundLabel = (value) => (value === 'skipped' ? 'Skipped the question' : FOUND_VIA[value] ?? value);
//# sourceMappingURL=found.js.map