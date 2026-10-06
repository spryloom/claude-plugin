import { stringify as stringifyYaml } from 'yaml';
import { JOB_RULES } from './types.js';
const HEADER = `# spryloom.yaml
#
# Written by your coding agent when the app was published, and safe to edit.
# Spryloom provisions exactly what this file declares, and your app's label
# page is generated from it, so what your coworkers see always matches what
# was actually created.
#
# Docs: https://spryloom.com/docs/manifest
`;
/**
 * Render a manifest as the file written into the user's repository.
 *
 * Key order is fixed so that re-publishing an unchanged app produces an
 * unchanged file and version diffs stay readable.
 */
export function serializeManifest(manifest) {
    const shaped = {
        app: {
            name: manifest.app.name,
            slug: manifest.app.slug,
            description: manifest.app.description,
        },
        runtime: {
            frontend: manifest.runtime.frontend,
            backend: manifest.runtime.backend,
            ...(manifest.runtime.dockerfile !== undefined && { dockerfile: manifest.runtime.dockerfile }),
            ...(manifest.runtime.build !== undefined && { build: manifest.runtime.build }),
            ...(manifest.runtime.start !== undefined && { start: manifest.runtime.start }),
        },
        access: {
            visibility: manifest.access.visibility,
            ...(manifest.access.domain !== undefined && { domain: manifest.access.domain }),
            signin: [...manifest.access.signin],
            admins: [...manifest.access.admins],
        },
        data: {
            postgres: manifest.data.postgres,
            tables: [...manifest.data.tables],
            uploads: manifest.data.uploads,
        },
        // Written only when declared, so a manifest from before M1* serialises to
        // the same file it always did.
        ...(manifest.jobs.length > 0 && {
            jobs: manifest.jobs.map((job) => ({
                name: job.name,
                command: job.command,
                schedule: job.schedule,
                ...(job.timezone !== 'UTC' && { timezone: job.timezone }),
                ...(job.timeoutMinutes !== JOB_RULES.defaultTimeoutMinutes && { timeout_minutes: job.timeoutMinutes }),
            })),
        }),
        ...(manifest.email && { email: true }),
        ...(manifest.egress.length > 0 && { egress: [...manifest.egress] }),
    };
    const body = stringifyYaml(shaped, {
        indent: 2,
        lineWidth: 0,
        singleQuote: false,
    });
    return `${HEADER}\n${body}`;
}
//# sourceMappingURL=serialize.js.map