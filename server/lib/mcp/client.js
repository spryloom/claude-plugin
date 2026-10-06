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
//# sourceMappingURL=client.js.map