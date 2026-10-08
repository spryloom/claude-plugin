/**
 * The `spryloom.yaml` contract.
 *
 * Decision D3: the coding agent writes this file while it builds the app, so the
 * platform is told what the app needs rather than having to infer it. Analysing
 * arbitrary code is a fallback, never the primary path.
 *
 * The manifest is also the source of the app's label page, which is the product's
 * trust surface. Anything a coworker is shown about what an app stores or can
 * reach is derived from here, so it cannot drift from what was provisioned.
 */
/**
 * What a manifest gets when nobody says otherwise.
 *
 * Only what works. `google` is a valid method and does nothing yet (D25), so
 * writing it into somebody's manifest puts a line in their contract that means
 * nothing — and the manifest is meant to be read and edited by hand. When
 * Google is added this becomes the place that changes.
 */
export const DEFAULT_SIGNIN = ['email_link'];
/** The limits on a page's lists (D113, spec §3.1). */
export const LIST_RULES = {
    maxLists: 20,
    /** Lowercase letters, digits and hyphens, starting with a letter, up to 40. */
    name: /^[a-z][a-z0-9-]{0,39}$/,
    modes: ['shared', 'own'],
};
/** The limits a job is held to (D85). */
export const JOB_RULES = {
    maxJobs: 5,
    /** The shortest gap allowed between two runs of one job. */
    minIntervalHours: 10,
    defaultTimeoutMinutes: 10,
    maxTimeoutMinutes: 15,
};
/**
 * Raised when a manifest cannot be used. Carries every problem found, not just
 * the first, so a person fixing the file sees the whole list at once.
 */
export class ManifestError extends Error {
    issues;
    constructor(issues) {
        super(formatIssues(issues));
        this.name = 'ManifestError';
        this.issues = issues;
    }
}
/** Render issues as the block the CLI and the agent show to a person. */
export function formatIssues(issues) {
    if (issues.length === 0)
        return 'spryloom.yaml is not valid.';
    const lines = [
        issues.length === 1
            ? 'spryloom.yaml has a problem:'
            : `spryloom.yaml has ${issues.length} problems:`,
        '',
    ];
    for (const issue of issues) {
        lines.push(`  ${issue.path}`);
        lines.push(`    ${issue.message}`);
        if (issue.hint !== undefined)
            lines.push(`    ${issue.hint}`);
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}
//# sourceMappingURL=types.js.map