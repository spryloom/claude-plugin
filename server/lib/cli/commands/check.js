import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detect } from '../../detect/index.js';
import { MANIFEST_FILENAME, ManifestError, parseManifest, } from '../../manifest/index.js';
import { describeRows, painter, wrap } from '../ui.js';
async function readManifest(root) {
    let source;
    try {
        source = await readFile(join(root, MANIFEST_FILENAME), 'utf8');
    }
    catch {
        return undefined;
    }
    return parseManifest(source);
}
function describeData(manifest, detection) {
    if (manifest !== undefined) {
        if (!manifest.data.postgres)
            return 'none';
        const count = manifest.data.tables.length;
        return `postgres, ${count} ${count === 1 ? 'table' : 'tables'}`;
    }
    return detection.usesPostgres ? 'postgres (a database client is in your dependencies)' : 'none';
}
/** Print one finding: what is wrong, where, and what to do. */
function renderFinding(finding, paint) {
    const mark = finding.severity === 'blocker' ? paint.red('✗') : paint.yellow('!');
    const where = finding.file === undefined
        ? ''
        : ` ${paint.cyan(finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`)}`;
    return [
        '',
        `  ${mark}${where}`,
        ...wrap(finding.message, '    '),
        ...wrap(finding.hint, '    ').map((line) => paint.dim(line)),
    ];
}
/**
 * Report what Spryloom sees in a folder and whether it could be published.
 *
 * Reads the manifest when one exists, since the manifest is the contract (D3),
 * and falls back to inspecting the folder when it does not.
 */
export async function check(root, context) {
    const paint = painter(context.colour);
    const { output } = context;
    let manifest;
    try {
        manifest = await readManifest(root);
    }
    catch (error) {
        if (error instanceof ManifestError) {
            output.err(error.message);
            return 1;
        }
        throw error;
    }
    const detection = await detect(root);
    const title = manifest?.app.name ?? 'This folder';
    output.out('');
    output.out(paint.bold(title));
    if (manifest !== undefined) {
        output.out(paint.dim(`  ${manifest.app.description}`));
    }
    output.out('');
    const rows = [
        ['frontend', manifest?.runtime.frontend ?? detection.frontend],
        ['backend', manifest?.runtime.backend ?? detection.backend],
        ['database', describeData(manifest, detection)],
        ['uploads', manifest?.data.uploads === true ? 'yes' : 'none'],
    ];
    if (manifest !== undefined) {
        rows.push(['who can use it', describeVisibility(manifest)]);
    }
    if (detection.dockerfile !== undefined) {
        rows.push(['dockerfile', `${detection.dockerfile} (yours, used as-is)`]);
    }
    for (const line of describeRows(rows, paint))
        output.out(line);
    for (const finding of detection.findings) {
        for (const line of renderFinding(finding, paint))
            output.out(line);
    }
    const blockers = detection.findings.filter((f) => f.severity === 'blocker');
    output.out('');
    if (blockers.length > 0) {
        output.out(paint.red(blockers.length === 1
            ? 'One thing has to be fixed before this can be published.'
            : `${blockers.length} things have to be fixed before this can be published.`));
        return 1;
    }
    if (manifest === undefined) {
        output.out(paint.dim(`No ${MANIFEST_FILENAME} yet. Run \`spry init\` to write one.`));
        return 0;
    }
    output.out(paint.green('Ready to publish.'));
    return 0;
}
function describeVisibility(manifest) {
    switch (manifest.access.visibility) {
        case 'private':
            return 'only you';
        case 'invited':
            return 'people you invite';
        case 'company':
            return `anyone at ${manifest.access.domain ?? 'your company'}`;
        case 'link':
            return 'anyone with the link, after signing in';
    }
}
//# sourceMappingURL=check.js.map