import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { detect } from '../../detect/index.js';
import { DEFAULT_SIGNIN, MANIFEST_FILENAME, ManifestError, deriveSlug, serializeManifest, validateManifest, } from '../../manifest/index.js';
import { describeRows, painter, wrap } from '../ui.js';
async function existingName(root) {
    try {
        const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        return typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : undefined;
    }
    catch {
        return undefined;
    }
}
async function existingDescription(root) {
    try {
        const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        return typeof pkg.description === 'string' && pkg.description !== ''
            ? pkg.description
            : undefined;
    }
    catch {
        return undefined;
    }
}
async function manifestExists(root) {
    try {
        await readFile(join(root, MANIFEST_FILENAME), 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Write a `spryloom.yaml` describing this folder.
 *
 * Normally the coding agent writes this file while it builds the app (D3). This
 * command exists for apps that arrive without one, and for anyone who would
 * rather start from something correct and edit it.
 */
export async function init(root, options, context) {
    const paint = painter(context.colour);
    const { output } = context;
    if (!options.force && (await manifestExists(root))) {
        output.err(`${MANIFEST_FILENAME} already exists.`);
        output.err('');
        for (const line of wrap('Edit it directly, or pass --force to write a new one over it.', '')) {
            output.err(line);
        }
        return 1;
    }
    const detection = await detect(root);
    const blockers = detection.findings.filter((f) => f.severity === 'blocker');
    if (blockers.length > 0) {
        for (const blocker of blockers) {
            output.err(blocker.message);
            for (const line of wrap(blocker.hint, '  '))
                output.err(line);
        }
        return 1;
    }
    const name = options.name ?? (await existingName(root)) ?? basename(resolve(root));
    const description = options.description ?? (await existingDescription(root));
    if (description === undefined) {
        output.err('This app needs a one-sentence description.');
        output.err('');
        for (const line of wrap('Your coworkers see it on the app\'s label page and in the invitation email, so it should say what the app does.', '  ')) {
            output.err(line);
        }
        output.err('');
        output.err('  spry init --description "Reconciles vendor invoices against purchase orders."');
        return 2;
    }
    const visibility = options.visibility ?? 'private';
    let manifest;
    try {
        manifest = validateManifest({
            app: { name, slug: deriveSlug(name), description },
            runtime: {
                frontend: detection.frontend,
                backend: detection.backend,
                ...(detection.dockerfile !== undefined && { dockerfile: detection.dockerfile }),
                ...(detection.build !== undefined && { build: detection.build }),
                ...(detection.start !== undefined && { start: detection.start }),
            },
            access: {
                visibility,
                ...(options.domain !== undefined && { domain: options.domain }),
                signin: [...DEFAULT_SIGNIN],
                admins: options.admins ?? [],
            },
            data: {
                postgres: options.noDatabase === true ? false : options.tables !== undefined ? true : detection.usesPostgres,
                tables: options.noDatabase === true ? [] : (options.tables ?? []),
                uploads: false,
            },
        });
    }
    catch (error) {
        if (error instanceof ManifestError) {
            output.err(error.message);
            // A database was inferred from the dependency list but the tables cannot
            // be, and the label page has to be able to say what the app stores.
            if (error.issues.some((issue) => issue.path === 'data.tables')) {
                output.err('');
                for (const line of wrap('Spryloom found a database client in your dependencies. Name the tables your app stores, so its label page can tell coworkers what it holds.', '  ')) {
                    output.err(line);
                }
                output.err('');
                output.err('  spry init --table invoices --table purchase_orders');
                output.err('');
                for (const line of wrap('If this app stores nothing, say so:', '  '))
                    output.err(line);
                output.err('');
                output.err('  spry init --no-database');
            }
            return 1;
        }
        throw error;
    }
    await writeFile(join(root, MANIFEST_FILENAME), serializeManifest(manifest), 'utf8');
    output.out('');
    output.out(`${paint.green('Wrote')} ${MANIFEST_FILENAME}`);
    output.out('');
    for (const line of describeRows([
        ['name', manifest.app.name],
        ['address', `${manifest.app.slug}.<your workspace>.spryloom.app`],
        ['frontend', manifest.runtime.frontend],
        ['backend', manifest.runtime.backend],
        ['database', manifest.data.postgres ? 'postgres' : 'none'],
    ], paint)) {
        output.out(line);
    }
    for (const finding of detection.findings) {
        output.out('');
        output.out(`  ${paint.yellow('!')} ${finding.message}`);
        for (const line of wrap(finding.hint, '    '))
            output.out(paint.dim(line));
    }
    output.out('');
    output.out(paint.dim('Read it, edit anything that is wrong, then run `spry check`.'));
    return 0;
}
//# sourceMappingURL=init.js.map