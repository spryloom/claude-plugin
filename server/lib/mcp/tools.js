/**
 * The tools a coding agent calls.
 *
 * Decision D3: publishing is an agent tool call first and a command second. These
 * are the functions behind those tools, written so they can be tested without an
 * MCP transport.
 *
 * Every result is text the agent will read aloud to the user, so the wording here
 * is the product's wording, not a debug dump. A failure says what went wrong and
 * what to do, and never asks the user to fix something the agent caused (D11).
 */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { detect } from '../detect/index.js';
import { PageFileError, RepositoryError, ZipError, parseSource, resolveSource, } from '../source/index.js';
import { DEFAULT_SIGNIN, MANIFEST_FILENAME, ManifestError, deriveSlug, parseManifest, serializeManifest, validateManifest, } from '../manifest/index.js';
import { SpryloomFailure } from './client.js';
const ok = (text) => ({ text, isError: false });
const failed = (text) => ({ text, isError: true });
const SIGNIN_DEFAULT = DEFAULT_SIGNIN;
async function loadManifest(root) {
    try {
        return parseManifest(await readFile(join(root, MANIFEST_FILENAME), 'utf8'));
    }
    catch (error) {
        if (error instanceof ManifestError)
            throw error;
        return undefined;
    }
}
function describeFinding(finding) {
    const where = finding.file === undefined ? '' : ` (${finding.file}${finding.line === undefined ? '' : `:${finding.line}`})`;
    return `  ${finding.message}${where}\n    ${finding.hint}`;
}
/**
 * Publish a folder.
 *
 * The manifest is written when it is missing, because the agent knows what the
 * app needs and the platform should not have to guess (D3).
 */
export async function publish(args, context, watch = {}) {
    const user = await context.client.currentUser();
    if (user === undefined) {
        return failed('Not signed in to Spryloom.\n\nRun `spry login` in the terminal, then publish again.');
    }
    // A folder, a zip of one, or a GitHub repository, all of which end as a
    // folder on this machine (D35). An agent almost always has the folder, but
    // there is no reason for it to be the only thing that works, and the tool
    // description says so.
    const source = parseSource(args.root);
    let resolved;
    try {
        resolved = await resolveSource(source, {
            ...(process.env['GITHUB_TOKEN'] !== undefined && { token: process.env['GITHUB_TOKEN'] }),
        });
    }
    catch (error) {
        if (error instanceof ZipError || error instanceof RepositoryError || error instanceof PageFileError) {
            return failed(`${error.message}\n\n${error.hint}\n\nNothing was deployed.`);
        }
        throw error;
    }
    try {
        return await publishResolved(args, context, user, resolved, watch);
    }
    finally {
        await resolved.dispose();
    }
}
async function publishResolved(args, context, user, resolved, watch) {
    const root = resolved.root;
    const detection = await detect(root);
    const blockers = detection.findings.filter((finding) => finding.severity === 'blocker');
    if (blockers.length > 0) {
        return failed([
            'This app cannot be published yet.',
            '',
            ...blockers.map(describeFinding),
            '',
            'Nothing was deployed.',
        ].join('\n'));
    }
    let manifest;
    /** True when this run invented the manifest rather than reading one. */
    let generated = false;
    try {
        const existing = await loadManifest(root);
        manifest =
            existing ??
                buildManifest(args, detection, resolved.suggestedName, { slug: user.workspace, ...(user.domain !== undefined && { domain: user.domain }) }, resolved.suggestedDescription);
        if (existing === undefined) {
            generated = true;
            await writeFile(join(root, MANIFEST_FILENAME), serializeManifest(manifest), 'utf8');
        }
    }
    catch (error) {
        if (error instanceof ManifestError) {
            return failed(`${error.message}\n\nNothing was deployed.`);
        }
        throw error;
    }
    const publishId = (context.newPublishId ?? randomUUID)();
    try {
        const result = await context.client.publish({
            manifest,
            root,
            publishId,
            source: args.source ?? 'agent',
        }, watch);
        const success = renderSuccess(manifest, result, detection.findings);
        // The manifest is the contract, and this run invented one. For a folder it
        // sits next to the app. For a zip or a repository it went into a temporary
        // folder that is about to be deleted, so the agent is handed it to write
        // where it belongs; saying nothing would leave the app without the file it
        // is supposed to have (D35).
        const notes = resolved.notes !== undefined && resolved.notes.length > 0 ? `\n\n${resolved.notes.join('\n')}` : '';
        return ok(generated && resolved.temporary && resolved.singleFile !== true
            ? [
                success,
                '',
                `Spryloom generated this ${MANIFEST_FILENAME}. ${resolved.describe} is not a folder on this machine, so it could not be saved. Write it into the app:`,
                '',
                serializeManifest(manifest),
            ].join('\n') + notes
            : success + notes);
    }
    catch (error) {
        if (error instanceof SpryloomFailure) {
            return failed([
                error.message,
                '',
                error.hint,
                '',
                error.previousVersionIntact
                    ? 'Nothing was deployed. Your previous version is still live.'
                    : 'Nothing was deployed.',
            ].join('\n'));
        }
        throw error;
    }
}
function buildManifest(args, detection, suggestedName, workspace, suggestedDescription) {
    // Falling back to a generic name would put "App" on the label page and in the
    // app's web address. What the source suggests is at least the user's own word
    // for it: the folder, the repository, or the zip.
    const name = args.name ?? suggestedName;
    const wantsDatabase = args.tables !== undefined ? args.tables.length > 0 : detection.usesPostgres;
    const domain = args.domain ?? workspace.domain;
    return validateManifest({
        app: {
            name,
            slug: deriveSlug(name),
            description: args.description ?? suggestedDescription ?? '',
        },
        runtime: {
            frontend: detection.frontend,
            backend: detection.backend,
            ...(detection.dockerfile !== undefined && { dockerfile: detection.dockerfile }),
            ...(detection.build !== undefined && { build: detection.build }),
            ...(detection.start !== undefined && { start: detection.start }),
        },
        access: {
            visibility: args.visibility,
            ...(args.visibility === 'company' && domain !== undefined && { domain }),
            signin: [...SIGNIN_DEFAULT],
            admins: args.admins ?? [],
        },
        data: {
            postgres: wantsDatabase,
            tables: args.tables ?? [],
            uploads: false,
        },
    });
}
function renderSuccess(manifest, result, findings) {
    const lines = [`Published: ${result.url}`, ''];
    for (const item of result.created)
        lines.push(`  ${item}`);
    if (result.created.length > 0)
        lines.push('');
    lines.push(`  Version ${result.version}`);
    lines.push(`  Sign-in  ${describeAudience(manifest)}`);
    if (manifest.data.postgres) {
        const count = manifest.data.tables.length;
        // No snapshot line. Nothing takes one until Release 2, and this printed
        // "snapshot taken" for every app with a database until 2026-09-19.
        lines.push(`  Data     ${count} ${count === 1 ? 'table' : 'tables'}`);
    }
    // What the folder showed before publishing, and what the platform saw while
    // publishing, such as a script a page loads that browsers will block (D105).
    const warnings = [...findings.filter((finding) => finding.severity === 'warning'), ...result.warnings];
    if (warnings.length > 0) {
        lines.push('', 'Worth fixing:');
        for (const warning of warnings)
            lines.push(describeFinding(warning));
    }
    lines.push('', 'Roll back at any time with the rollback tool.');
    return lines.join('\n');
}
function describeAudience(manifest) {
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
export async function status(args, context) {
    const found = await context.client.status(args.slug);
    if (found === undefined)
        return failed(`There is no app called "${args.slug}".`);
    // The labels are padded to the longest one rather than to a number written
    // here, so adding a row cannot quietly knock the column out of line.
    const rows = [
        ['Status', found.live ? (found.kind === 'page' ? 'live, a page: no server' : 'live') : 'not running'],
        ['Version', String(found.version)],
        ['Using it', String(found.users)],
        ['Shared with', found.sharedWith],
        ['Last published', new Date(found.lastPublishedAt * 1000).toISOString().slice(0, 10)],
    ];
    const width = Math.max(...rows.map(([label]) => label.length));
    return ok([found.url, '', ...rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)].join('\n'));
}
export async function exportApp(args, context) {
    try {
        const bundle = await context.client.exportApp(args.slug);
        return ok(JSON.stringify(bundle, null, 2));
    }
    catch (error) {
        if (error instanceof SpryloomFailure)
            return failed(`${error.message}\n\n${error.hint}`);
        throw error;
    }
}
export async function logs(args, context) {
    const lines = await context.client.logs(args.slug, args.lines ?? 100);
    if (lines.length === 0)
        return ok('No logs yet.');
    return ok(lines.join('\n'));
}
export async function rollback(args, context) {
    try {
        const result = await context.client.rollback(args.slug, args.toVersion);
        return ok(`Rolled back to version ${result.version}.\n\n${result.url}`);
    }
    catch (error) {
        if (error instanceof SpryloomFailure) {
            return failed(`${error.message}\n\n${error.hint}`);
        }
        throw error;
    }
}
export async function restore(args, context) {
    try {
        const result = await context.client.restore(args.slug);
        return ok(`Restored ${args.slug} at version ${result.version}.\n\n${result.url}`);
    }
    catch (error) {
        if (error instanceof SpryloomFailure)
            return failed(`${error.message}\n\n${error.hint}`);
        throw error;
    }
}
export async function invite(args, context) {
    if (args.emails.length === 0)
        return failed('No addresses were given.');
    const result = await context.client.invite(args.slug, args.emails);
    // Someone already invited is sent a fresh invitation (D100), which is not a
    // refusal: reporting it as a failure would have the agent say something went
    // wrong when nothing did. A refusal is an address that cannot be given access.
    const resent = result.resent;
    const refused = result.skipped.filter((skip) => skip.code !== 'already_invited');
    const lines = [];
    if (result.invited.length > 0) {
        lines.push(`Invited ${result.invited.length} ${result.invited.length === 1 ? 'person' : 'people'}.`, '', "They'll get an email with a button that signs them in.");
    }
    if (resent.length > 0) {
        if (lines.length > 0)
            lines.push('');
        lines.push(resent.length === 1
            ? `Sent ${resent[0]} a fresh invitation. The earlier link no longer works.`
            : `Sent ${resent.length} people a fresh invitation. Their earlier links no longer work.`);
    }
    if (refused.length > 0) {
        if (lines.length > 0)
            lines.push('');
        lines.push('Not invited:');
        for (const skip of refused)
            lines.push(`  ${skip.email} — ${skip.reason}`);
    }
    // A failure is nothing achieved at all. Inviting two people and being unable
    // to invite a third did something, and the text above says exactly what, so
    // reporting it as a failed call would have the agent describe it wrongly.
    const achieved = result.invited.length + resent.length;
    return achieved === 0 ? failed(lines.join('\n')) : ok(lines.join('\n'));
}
export async function uninvite(args, context) {
    try {
        await context.client.revokeInvite(args.slug, args.email);
        return ok(`Removed ${args.email} from "${args.slug}".`);
    }
    catch (error) {
        if (error instanceof SpryloomFailure)
            return failed(`${error.message}\n\n${error.hint}`);
        throw error;
    }
}
/**
 * Give an app a custom domain (D74).
 *
 * The agent tool covers the whole small flow: adding a hostname returns the DNS
 * records to add and says to verify once they are in place; the person, or the
 * agent on their behalf, runs verify after DNS has propagated. Removing and
 * listing are here for completeness. Adding is refused for anyone but the app's
 * owner or an admin, by the control plane.
 */
export async function customDomain(args, context) {
    const needHost = () => args.hostname === undefined ? failed('Which hostname? For example: tools.yourcompany.com') : undefined;
    try {
        switch (args.action) {
            case 'add': {
                const missing = needHost();
                if (missing !== undefined)
                    return missing;
                const r = await context.client.addDomain(args.slug, args.hostname);
                return ok([
                    `Added ${r.hostname} to ${args.slug}. Two DNS records prove control and point it here:`,
                    '',
                    `  ${r.challenge.name}  ${r.challenge.type}  ${r.challenge.value}`,
                    `  ${r.cname.name}  ${r.cname.type}  ${r.cname.value}`,
                    '',
                    `Once both are in place, verify with the same tool and action "verify".`,
                ].join('\n'));
            }
            case 'verify': {
                const missing = needHost();
                if (missing !== undefined)
                    return missing;
                const r = await context.client.verifyDomain(args.slug, args.hostname);
                return r.verified
                    ? ok(`Verified ${r.hostname}. It now serves ${args.slug}.`)
                    : failed(`${r.hostname} is not verified yet.`);
            }
            case 'list': {
                const domains = await context.client.listDomains(args.slug);
                if (domains.length === 0)
                    return ok(`${args.slug} has no custom domains.`);
                return ok(domains.map((d) => `  ${d.hostname}  ${d.verified ? 'verified' : 'not verified'}`).join('\n'));
            }
            case 'remove': {
                const missing = needHost();
                if (missing !== undefined)
                    return missing;
                await context.client.removeDomain(args.slug, args.hostname);
                return ok(`Removed ${args.hostname} from ${args.slug}.`);
            }
        }
    }
    catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
    }
}
//# sourceMappingURL=tools.js.map