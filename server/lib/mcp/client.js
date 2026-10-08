/**
 * What the MCP tools need from Spryloom, behind an interface.
 *
 * The interface exists so the tools can be tested without a network, and so the
 * decisions the tools make about wording and about what to do with a failure are
 * separable from how the request is sent.
 */
/**
 * A request the platform refused, with enough detail to act on.
 *
 * Used by every method rather than only by publish, so a caller can branch on
 * the reason instead of matching on a sentence.
 */
export class SpryloomFailure extends Error {
    /** Stable code, recorded so common failures can be prevented in the skill (D11). */
    reason;
    /** What the person should do. */
    hint;
    /** True when nothing was changed, so the previous version is still serving. */
    previousVersionIntact;
    /**
     * Output from the person's own build or app.
     *
     * Passed through rather than summarised: when a build fails, the compiler's
     * own words are more use than anything we could say about them.
     */
    logs;
    constructor(options) {
        super(options.message);
        this.name = 'SpryloomFailure';
        this.reason = options.reason;
        this.hint = options.hint;
        this.previousVersionIntact = options.previousVersionIntact ?? true;
        this.logs = options.logs ?? [];
    }
}
/**
 * Which page someone means: its address (`https://gear-wall.acme-com.spryloom.app`,
 * with or without `https://` and a path), or a slug in their own workspace.
 * Undefined when it is neither.
 */
export function pageAddress(input, ownWorkspace) {
    const text = input.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0]?.toLowerCase() ?? '';
    const SLUG = /^[a-z0-9]([a-z0-9-]{0,62})$/;
    if (SLUG.test(text))
        return { workspace: ownWorkspace, slug: text };
    const labels = text.split('.');
    const [slug, workspace] = labels;
    if (labels.length >= 4 && slug !== undefined && workspace !== undefined && SLUG.test(slug) && SLUG.test(workspace))
        return { workspace, slug };
    return undefined;
}
//# sourceMappingURL=client.js.map