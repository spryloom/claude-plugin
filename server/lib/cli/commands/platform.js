/**
 * The commands that talk to Spryloom.
 *
 * `init` and `check` work on a folder and need nothing else. These need a signed-in
 * terminal, so they share one way of saying "you are not signed in" and one way
 * of reporting a refusal: what went wrong, then what to do about it.
 */
import { basename, resolve } from 'node:path';
import { detect } from '../../detect/index.js';
import { DEFAULT_SIGNIN, MANIFEST_FILENAME, ManifestError, deriveSlug, parseManifest, serializeManifest, validateManifest, } from '../../manifest/index.js';
import { HttpSpryloomClient, SpryloomFailure, signIn } from '../../mcp/index.js';
import { RepositoryError, ZipError, parseSource, resolveSource, } from '../../source/index.js';
import { describeRows, painter, wrap } from '../ui.js';
import { canRedraw, clock as elapsedClock, labelOf, progressDisplay } from '../progress.js';
import { baseUrlFrom, clearSession, loadSession, saveSession } from '../session.js';
/** Print a refusal the way the acceptance document specifies: what, then what to do. */
/**
 * A failure, as the person should read it.
 *
 * `deploying` exists because "Nothing was deployed" is a sentence only a
 * command that deploys may say. Every failure carries `previousVersionIntact`,
 * which defaults to true, so until 2026-09-19 a refused invitation ended with
 * "Nothing was deployed." — true, irrelevant, and an invitation to wonder what
 * deployment had been going on.
 */
function reportFailure(output, error, deploying = false) {
    if (error instanceof SpryloomFailure) {
        output.err(error.message);
        if (error.hint !== '') {
            // Paragraphs are wrapped one at a time. A paragraph whose every line is
            // indented is a command or a record to copy, and is printed as written
            // rather than re-flowed into prose.
            for (const paragraph of error.hint.split(/\n{2,}/)) {
                output.err('');
                const lines = paragraph.split('\n');
                if (lines.every((line) => line.startsWith('  '))) {
                    for (const line of lines)
                        output.err(line);
                }
                else {
                    for (const line of wrap(paragraph, ''))
                        output.err(line);
                }
            }
        }
        if (error.logs.length > 0) {
            output.err('');
            for (const line of error.logs.slice(-20))
                output.err(`  ${line}`);
        }
        if (deploying && error.previousVersionIntact) {
            output.err('');
            // Just this. Whether a previous version is still serving is something only
            // the platform knows, so it says so in its own hint rather than having the
            // terminal guess and be wrong on a first publish.
            output.err('Nothing was deployed.');
        }
        return 1;
    }
    output.err(error instanceof Error ? error.message : String(error));
    return 1;
}
/** "publishing version 4 · building (1:12)", for the apps list. */
export function describeRunning(operation) {
    const doing = {
        publish: 'publishing',
        delete: 'deleting',
        rollback: 'rolling back',
        restore: 'restoring',
        restart: 'restarting',
    };
    const what = operation.version !== undefined && (operation.kind === 'publish' || operation.kind === 'rollback')
        ? `${doing[operation.kind]}${operation.kind === 'rollback' ? ' to' : ''} version ${operation.version}`
        : doing[operation.kind];
    const stage = operation.status === 'accepted' ? 'waiting to start' : labelOf(operation.stage, operation.kind).toLowerCase();
    return `${what} · ${stage} (${elapsedClock(operation.elapsedSeconds)})`;
}
/** A size the way a person reads it. */
function describeBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
const notSignedIn = (output) => {
    output.err('Not signed in.');
    output.err('');
    output.err('  spry login');
    return 1;
};
async function clientFor(context) {
    const baseUrl = baseUrlFrom();
    const session = await loadSession(baseUrl);
    if (session === undefined)
        return undefined;
    return {
        client: new HttpSpryloomClient({ baseUrl, token: session.token, clientVersion: context.version }),
        email: session.email,
    };
}
// ---------------------------------------------------------------------------
export async function login(context, email) {
    const paint = painter(context.colour);
    const { output } = context;
    const baseUrl = baseUrlFrom();
    if (email === undefined || email === '') {
        output.err('Which email address should Spryloom send the link to?');
        output.err('');
        output.err('  spry login --email you@company.com');
        return 2;
    }
    output.out('');
    output.out(`Sending a link to ${paint.bold(email)}.`);
    output.out('');
    try {
        const result = await signIn({
            baseUrl,
            email,
            // Shown before the person opens anything, so they have something to
            // compare against. A link on its own approves whatever sign-in it was
            // made for, which need not be this one.
            onCode: (userCode, approveUrl) => {
                output.out(`  ${paint.bold(userCode)}`);
                output.out('');
                // A Spryloom running on this machine has nowhere to send mail from, so
                // it hands back the link instead of hiding it in a log file. The code
                // still has to match: what changes is delivery, not the check (D55).
                const instruction = approveUrl === undefined
                    ? 'Open the link in your email. It will show this code. Approve the sign-in only if the code matches.'
                    : 'This Spryloom is running on this machine, so nothing was emailed. Open the link below. It will show this code. Approve the sign-in only if the code matches.';
                for (const line of wrap(instruction, '')) {
                    output.out(paint.dim(line));
                }
                if (approveUrl !== undefined) {
                    output.out('');
                    output.out(`  ${approveUrl}`);
                }
                output.out('');
            },
        });
        await saveSession({ baseUrl, token: result.token, email: result.email, workspace: result.workspace });
        output.out(`${paint.green('Signed in')} as ${result.email}`);
        output.out(paint.dim(`Workspace: ${result.workspace}`));
        return 0;
    }
    catch (error) {
        return reportFailure(output, error);
    }
}
export async function logout(context, everywhere = false) {
    // Signing out everywhere has to happen before the local session is cleared,
    // because clearing it first would leave nothing to authenticate the request
    // with, and the other terminals would stay signed in.
    if (everywhere) {
        const found = await clientFor(context);
        if (found === undefined)
            return notSignedIn(context.output);
        try {
            const revoked = await found.client.signOutEverywhere();
            await clearSession(baseUrlFrom());
            context.output.out(`Signed out of ${revoked} ${revoked === 1 ? 'terminal' : 'terminals'}, this one included.`);
            return 0;
        }
        catch (error) {
            // The local session is deliberately kept. Clearing it would look like it
            // worked while every other terminal stayed signed in.
            return reportFailure(context.output, error);
        }
    }
    // The token is revoked on the server, not only forgotten here: a copy of it,
    // in a transcript or a backup, stops working too. If Spryloom cannot be
    // reached the session is kept, for the same reason as above, so running
    // this again finishes the job.
    const found = await clientFor(context);
    if (found !== undefined) {
        try {
            await found.client.signOut();
        }
        catch (error) {
            return reportFailure(context.output, error);
        }
    }
    await clearSession(baseUrlFrom());
    context.output.out('Signed out.');
    return 0;
}
export async function whoami(context) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const user = await found.client.currentUser();
    if (user === undefined)
        return notSignedIn(context.output);
    context.output.out(user.email);
    context.output.out(painter(context.colour).dim(`Workspace: ${user.workspace}`));
    return 0;
}
export async function apps(context) {
    const paint = painter(context.colour);
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    // The list is small enough to read, so it is a list rather than a table with
    // a header nobody needs.
    const list = await found.client.listApps();
    if (list.length === 0) {
        context.output.out('');
        context.output.out('No apps yet.');
        context.output.out(paint.dim('Publish one with `spry publish`.'));
        return 0;
    }
    context.output.out('');
    for (const app of list) {
        const state = app.pending
            ? paint.yellow('PUBLISHING')
            : app.archived
                ? paint.dim('ARCHIVED')
                : app.live
                    ? paint.green('LIVE')
                    : paint.yellow('STOPPED');
        context.output.out(`  ${paint.bold(app.name)}  ${state}`);
        context.output.out(`  ${paint.dim(app.url)}`);
        if (app.pending !== true) {
            context.output.out(paint.dim(`  ${app.users} ${app.users === 1 ? 'person' : 'people'} · ${app.sharedWith} · version ${app.version}${app.kind === 'page' ? ' · page' : ''}`));
        }
        // Running now, so somebody who stopped watching can see it is still going (finding F7).
        if (app.operation !== undefined)
            context.output.out(`  ${paint.yellow('▸')} ${describeRunning(app.operation)}`);
        context.output.out('');
    }
    return 0;
}
export async function exportApp(context, slug) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    try {
        const bundle = await found.client.exportApp(slug);
        context.output.out(JSON.stringify(bundle, null, 2));
        return 0;
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
export async function publish(context, options) {
    const paint = painter(context.colour);
    const { output } = context;
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(output);
    // A folder, a zip of one, or a GitHub repository. All three end as a folder
    // on this machine, so everything below this point is the same for each (D35).
    const source = parseSource(options.root);
    let resolved;
    try {
        resolved = await resolveSource(source, {
            ...(options.token !== undefined && { token: options.token }),
        });
    }
    catch (error) {
        if (error instanceof ZipError || error instanceof RepositoryError) {
            output.err(error.message);
            output.err('');
            for (const line of wrap(error.hint, '  '))
                output.err(line);
            output.err('');
            output.err('Nothing was deployed.');
            return 1;
        }
        throw error;
    }
    try {
        return await publishResolved(context, options, found, resolved, source);
    }
    finally {
        await resolved.dispose();
    }
}
async function publishResolved(context, options, found, resolved, source) {
    const paint = painter(context.colour);
    const { output } = context;
    const root = resolved.root;
    if (source.kind !== 'folder') {
        output.out('');
        output.out(paint.dim(`Reading ${resolved.describe}`));
    }
    const detection = await detect(root);
    const blockers = detection.findings.filter((finding) => finding.severity === 'blocker');
    if (blockers.length > 0) {
        for (const blocker of blockers) {
            output.err(blocker.message);
            for (const line of wrap(blocker.hint, '  '))
                output.err(line);
        }
        output.err('');
        output.err('Nothing was deployed.');
        return 1;
    }
    // The manifest is the contract, so it is read rather than inferred when it is
    // there, and written when it is not (D3).
    const { readFile, writeFile } = await import('node:fs/promises');
    let manifest;
    /** True when this run invented the manifest rather than reading one. */
    let generated = false;
    try {
        manifest = parseManifest(await readFile(`${root}/${MANIFEST_FILENAME}`, 'utf8'));
        if (options.visibility !== undefined) {
            output.err(`${MANIFEST_FILENAME} already says who can open ${manifest.app.name}: ${manifest.access.visibility}.`);
            output.err('');
            output.err('  --visibility is for a page or a folder that has no spryloom.yaml. Edit access.visibility in the file instead, then publish again.');
            output.err('');
            output.err('Nothing was deployed.');
            return 2;
        }
    }
    catch (error) {
        if (error instanceof ManifestError) {
            output.err(error.message);
            return 1;
        }
        const name = options.name ?? resolved.suggestedName;
        // A single page brings no manifest, but its own title says what it is (D105).
        const description = options.description ?? resolved.suggestedDescription;
        if (description === undefined) {
            output.err(`${MANIFEST_FILENAME} is missing, and this app needs a one-sentence description.`);
            output.err('');
            for (const line of wrap("Your coworkers read it before opening something a colleague made, so it should say what the app does.", '  ')) {
                output.err(line);
            }
            output.err('');
            output.err('  spry publish --description "Reconciles vendor invoices against purchase orders."');
            return 2;
        }
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
                    visibility: options.visibility ?? 'private',
                    ...(options.domain !== undefined && { domain: options.domain }),
                    signin: [...DEFAULT_SIGNIN],
                    admins: [],
                },
                data: { postgres: false, tables: [], uploads: false },
            });
        }
        catch (manifestError) {
            if (manifestError instanceof ManifestError) {
                output.err(manifestError.message);
                return 1;
            }
            throw manifestError;
        }
        generated = true;
        await writeFile(`${root}/${MANIFEST_FILENAME}`, serializeManifest(manifest), 'utf8');
    }
    output.out('');
    output.out(`Publishing ${paint.bold(manifest.app.name)}`);
    output.out('');
    // Watching, not working: Ctrl-C stops the watching and the publish carries on (D99).
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    let display;
    const started = Date.now();
    try {
        const result = await found.client.publish({
            manifest,
            root,
            publishId: `cli-${Date.now().toString(36)}`,
            source: 'cli',
        }, {
            onPacked: (bytes) => output.out(`  ${paint.green('✓')} Packed ${describeBytes(bytes)}`),
            onAttach: (running) => output.out(`  A publish of ${running.app} is already running. Watching it.`),
            onProgress: (operation) => {
                if (display === undefined) {
                    output.out(`  ${paint.green('✓')} Uploaded`);
                    display = progressDisplay({
                        output,
                        paint,
                        redraw: canRedraw(context.colour),
                        footer: 'Ctrl-C stops watching; the publish carries on.',
                    });
                }
                display.update(operation);
            },
            signal: controller.signal,
        });
        display?.stop();
        display = undefined;
        output.out('');
        output.out(`  ${paint.green('✓')} Live in ${elapsedClock((Date.now() - started) / 1000)}`);
        for (const item of result.created)
            output.out(`  ${paint.green('✓')} ${item}`);
        output.out('');
        output.out(paint.bold(result.url));
        output.out('');
        // A page is stored, not built (D105), so there is no build time to report.
        const isPage = result.created.some((item) => item.startsWith('a page'));
        for (const line of describeRows([['version', String(result.version)], ...(isPage ? [] : [['built in', elapsedClock(result.buildSeconds)]])], paint)) {
            output.out(line);
        }
        const warnings = [...result.warnings, ...detection.findings.filter((f) => f.severity === 'warning')];
        if (warnings.length > 0) {
            output.out('');
            output.out('Worth fixing:');
            for (const warning of warnings) {
                const where = warning.file === undefined ? '' : ` (${warning.file}${warning.line === undefined ? '' : `:${warning.line}`})`;
                output.out(`  ${paint.yellow('!')} ${warning.message}${where}`);
                for (const line of wrap(warning.hint, '    '))
                    output.out(paint.dim(line));
            }
        }
        // The manifest is the contract, and this run invented one because the source
        // did not carry it. For a folder it was written next to the app and is
        // there to edit. For a zip or a repository it went into a temporary folder
        // that is about to be deleted, so it is printed instead: saying nothing
        // would leave someone believing their app now has a manifest when it does
        // not, and the next publish would invent a different one (D35).
        // Files a single page links to that it could not bring (D105).
        for (const [index, note] of (resolved.notes ?? []).entries()) {
            if (index === 0)
                output.out('');
            output.out(index === 0 ? `${paint.yellow('!')} ${note}` : paint.dim(`  ${note}`));
        }
        // A single page needs no manifest of its own, so nothing is printed for it.
        if (generated && resolved.temporary && resolved.singleFile !== true) {
            output.out('');
            output.out(`Spryloom wrote a ${MANIFEST_FILENAME} for this publish, from what it found.`);
            for (const line of wrap(`It could not be saved, because ${resolved.describe} is not a folder on this machine. Add this to the app so the next publish uses yours:`, '')) {
                output.out(paint.dim(line));
            }
            output.out('');
            for (const line of serializeManifest(manifest).split('\n'))
                output.out(`  ${line}`);
        }
        output.out('');
        output.out(paint.dim('Invite people with `spry invite`, or roll back with `spry rollback`.'));
        return 0;
    }
    catch (error) {
        display?.stop();
        if (error instanceof SpryloomFailure && error.reason === 'stopped_watching') {
            output.out('');
            output.out(controller.signal.aborted
                ? 'Stopped watching. The publish carries on: see it with `spry apps`, or watch it again with `spry publish` from the same folder.'
                : `${error.message} ${error.hint}`);
            return controller.signal.aborted ? 130 : 1;
        }
        output.out('');
        return reportFailure(output, error, true);
    }
    finally {
        process.off('SIGINT', interrupt);
    }
}
export async function invite(context, slug, emails) {
    const paint = painter(context.colour);
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    if (emails.length === 0) {
        context.output.err('No addresses were given.');
        context.output.err('');
        context.output.err('  spry invite reconciler --email ryan@acme.com');
        return 2;
    }
    try {
        const result = await found.client.invite(slug, emails);
        // Someone already invited is sent a fresh invitation, since the button in
        // one lasts a week (D100). Neither is a refusal; only an address that
        // cannot be given access makes the command fail.
        const resent = result.resent;
        const refused = result.skipped.filter((skip) => skip.code !== 'already_invited');
        if (result.invited.length > 0) {
            context.output.out(`${paint.green('Invited')} ${result.invited.length} ${result.invited.length === 1 ? 'person' : 'people'}.`);
            context.output.out(paint.dim("They'll get an email with a button that signs them in."));
        }
        if (resent.length > 0) {
            context.output.out(resent.length === 1
                ? `Sent ${resent[0]} a fresh invitation. The earlier link no longer works.`
                : `Sent ${resent.length} people a fresh invitation. Their earlier links no longer work.`);
        }
        if (refused.length > 0) {
            context.output.out('');
            context.output.out('Not invited:');
            for (const skip of refused) {
                context.output.out(`  ${skip.email} — ${skip.reason}`);
            }
        }
        // Nothing achieved is a failure. A partial result is not: it did something,
        // and the lines above say what.
        return result.invited.length + resent.length === 0 ? 1 : 0;
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
export async function uninvite(context, slug, email) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    try {
        await found.client.revokeInvite(slug, email);
        context.output.out(`Removed ${email} from "${slug}".`);
        return 0;
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
export async function rollback(context, slug, toVersion) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const watched = await watchLifecycle(context, `Rolling back ${slug}`, 'rollback', (watch) => found.client.rollback(slug, toVersion, watch));
    if (!watched.ok)
        return watched.code;
    context.output.out(`Rolled back to version ${watched.value.version}.`);
    context.output.out('');
    context.output.out(watched.value.url);
    return 0;
}
/**
 * Run a rollback, restore or restart and show it while it runs (D99): the
 * same stages, timer and Ctrl-C behaviour as a publish.
 */
async function watchLifecycle(context, title, kind, run) {
    const paint = painter(context.colour);
    context.output.out('');
    context.output.out(title);
    context.output.out('');
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    let display;
    try {
        const value = await run({
            onAttach: (running) => context.output.out(`  A ${running.kind} of ${running.app} is already running. Watching it.`),
            onProgress: (operation) => {
                display ??= progressDisplay({
                    output: context.output,
                    paint,
                    redraw: canRedraw(context.colour),
                    footer: `Ctrl-C stops watching; the ${kind} carries on.`,
                });
                display.update(operation);
            },
            signal: controller.signal,
        });
        display?.stop();
        context.output.out('');
        return { ok: true, value };
    }
    catch (error) {
        display?.stop();
        context.output.out('');
        if (error instanceof SpryloomFailure && error.reason === 'stopped_watching') {
            context.output.out(controller.signal.aborted ? `Stopped watching. The ${kind} carries on: check with \`spry apps\`.` : `${error.message} ${error.hint}`);
            return { ok: false, code: controller.signal.aborted ? 130 : 1 };
        }
        return { ok: false, code: reportFailure(context.output, error, kind === 'rollback') };
    }
    finally {
        process.off('SIGINT', interrupt);
    }
}
export async function logs(context, slug, lines) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    try {
        const output = await found.client.logs(slug, lines);
        if (output.length === 0) {
            // "No logs yet" until 2026-09-19, said whatever the reason, including the
            // long stretch when nothing could produce a log line at all. "Yet" reads
            // as a timing problem and sent people back to wait for something that was
            // never coming.
            context.output.out('Nothing has been logged.');
            context.output.out('An app that has just started may not have printed anything. One that is stopped prints nothing at all: `spry apps` says which.');
            return 0;
        }
        for (const line of output)
            context.output.out(line);
        return 0;
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
/**
 * The values an app needs and nobody can read back.
 *
 * Setting one takes it from the terminal and sends it. Listing gives names and
 * when they changed. There is no command that shows a value, on purpose: one
 * would be how they leak, through whoever can run it.
 */
export async function secrets(context, slug, action, pairs) {
    const paint = painter(context.colour);
    const { output } = context;
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(output);
    try {
        switch (action) {
            case undefined:
            case 'list': {
                const listed = await found.client.listSecrets(slug);
                if (listed.length === 0) {
                    output.out('');
                    output.out(`${slug} has no secrets.`);
                    output.out(paint.dim(`  spry secrets ${slug} set STRIPE_API_KEY=...`));
                    return 0;
                }
                output.out('');
                for (const secret of listed) {
                    const when = new Date(secret.updatedAt * 1000).toISOString().slice(0, 10);
                    output.out(`  ${paint.bold(secret.name)}`);
                    output.out(paint.dim(`  set by ${secret.updatedBy} on ${when}`));
                    output.out('');
                }
                output.out(paint.dim('Values are not shown. Nothing can read one back.'));
                return 0;
            }
            case 'set': {
                if (pairs.length === 0) {
                    output.err('Nothing to set.');
                    output.err('');
                    output.err(`  spry secrets ${slug} set STRIPE_API_KEY=sk_live_...`);
                    return 2;
                }
                let set = 0;
                for (const pair of pairs) {
                    const at = pair.indexOf('=');
                    if (at <= 0) {
                        output.err(`"${pair}" is not NAME=value.`);
                        output.err('');
                        for (const line of wrap('A secret needs both a name and a value, joined by an equals sign.', '  ')) {
                            output.err(line);
                        }
                        return 2;
                    }
                    await found.client.setSecret(slug, pair.slice(0, at), pair.slice(at + 1));
                    set += 1;
                }
                output.out(`${paint.green('Set')} ${set} ${set === 1 ? 'secret' : 'secrets'} on ${slug}.`);
                output.out(paint.dim('Publish again to give them to the running app.'));
                return 0;
            }
            case 'remove': {
                if (pairs.length === 0) {
                    output.err('Nothing to remove.');
                    output.err('');
                    output.err(`  spry secrets ${slug} remove STRIPE_API_KEY`);
                    return 2;
                }
                for (const name of pairs)
                    await found.client.removeSecret(slug, name);
                output.out(`Removed ${pairs.length} from ${slug}.`);
                output.out(paint.dim('Publish again so the running app stops seeing them.'));
                return 0;
            }
            default:
                output.err(`"${action}" is not something spry secrets does.`);
                output.err('');
                output.err('  spry secrets <app> list');
                output.err('  spry secrets <app> set NAME=value');
                output.err('  spry secrets <app> remove NAME');
                return 2;
        }
    }
    catch (error) {
        return reportFailure(output, error);
    }
}
/**
 * Start an app that has stopped.
 *
 * The version already there. An app that ran out of memory has not changed, and
 * rebuilding to recover from a crash wastes a minute and risks a different
 * result from a dependency that moved since.
 */
/**
 * Delete an app and everything made for it.
 *
 * The one command here that destroys something nobody can get back, so it is
 * deliberately harder to run than the rest: the name has to be typed again.
 * Not a prompt, because a prompt cannot be answered by an agent and this has to
 * work the same from a terminal and from a script. A second argument that must
 * match is a confirmation the person had to mean.
 *
 * It says what went, too. The pieces live at three providers, and somebody who
 * has just deleted something should not have to go and check whether the
 * database went with it.
 */
export async function remove(context, slug, confirmation) {
    const paint = painter(context.colour);
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    if (confirmation !== slug) {
        context.output.err(`Deleting ${slug} removes its database and everything in it.`);
        context.output.err('That cannot be undone. Type the name again to confirm:');
        context.output.err('');
        context.output.err(`  spry delete ${slug} ${slug}`);
        context.output.err('');
        context.output.err(paint.dim('To stop it serving and keep the data, archive it instead.'));
        return 2;
    }
    context.output.out('');
    context.output.out(`Deleting ${paint.bold(slug)}`);
    context.output.out('');
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    let display;
    try {
        const outcome = await found.client.deleteApp(slug, {
            onAttach: (running) => context.output.out(`  A ${running.kind} of ${running.app} is already running. Watching it.`),
            onProgress: (operation) => {
                display ??= progressDisplay({
                    output: context.output,
                    paint,
                    redraw: canRedraw(context.colour),
                    footer: 'Ctrl-C stops watching; the delete carries on.',
                });
                display.update(operation);
            },
            signal: controller.signal,
        });
        display?.stop();
        context.output.out('');
        // Said only because the platform checked, not because the commands returned (finding F4).
        context.output.out(`${paint.green('Deleted')} ${outcome.deleted}. Checked: machine, database, secrets and domains are gone.`);
        for (const gone of outcome.removed)
            context.output.out(paint.dim(`  ${gone}`));
        return 0;
    }
    catch (error) {
        display?.stop();
        if (error instanceof SpryloomFailure && error.reason === 'stopped_watching') {
            context.output.out('');
            context.output.out(controller.signal.aborted
                ? 'Stopped watching. The delete carries on: check with `spry apps`.'
                : `${error.message} ${error.hint}`);
            return controller.signal.aborted ? 130 : 1;
        }
        context.output.out('');
        return reportFailure(context.output, error);
    }
    finally {
        process.off('SIGINT', interrupt);
    }
}
export async function restart(context, slug) {
    const paint = painter(context.colour);
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const watched = await watchLifecycle(context, `Restarting ${slug}`, 'restart', (watch) => found.client.restart(slug, watch));
    if (!watched.ok)
        return watched.code;
    context.output.out(`${paint.green('Started')} ${slug}.`);
    context.output.out(paint.dim('It is answering again.'));
    return 0;
}
export async function archive(context, slug) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    try {
        await found.client.archive(slug);
        context.output.out(`Archived ${slug}. Its data is kept.`);
        context.output.out(`Bring it back with \`spry restore ${slug}\`.`);
        return 0;
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
export async function restore(context, slug) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const watched = await watchLifecycle(context, `Restoring ${slug}`, 'restore', (watch) => found.client.restore(slug, watch));
    if (!watched.ok)
        return watched.code;
    context.output.out(`Restored ${slug} at version ${watched.value.version}.`);
    context.output.out(watched.value.url);
    return 0;
}
/**
 * Custom domains (D74). `spry domain <action> <app> [hostname]`.
 *
 * Adding a domain prints the two DNS records to add; verify checks them; list
 * and remove do what they say. All of it is refused to anyone but the app's
 * owner or an admin, by the control plane.
 */
export async function domain(context, action, slug, hostname) {
    const paint = painter(context.colour);
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const usage = () => {
        context.output.err('Usage:');
        context.output.err('  spry domain add <app> <hostname>');
        context.output.err('  spry domain verify <app> <hostname>');
        context.output.err('  spry domain list <app>');
        context.output.err('  spry domain remove <app> <hostname>');
        return 2;
    };
    if (slug === undefined)
        return usage();
    try {
        switch (action) {
            case 'add': {
                if (hostname === undefined)
                    return usage();
                const result = await found.client.addDomain(slug, hostname);
                context.output.out(`${paint.green('Added')} ${result.hostname} to ${slug}.`);
                context.output.out('');
                context.output.out('To prove you control it, add this DNS record:');
                context.output.out(`  ${result.challenge.name}  ${result.challenge.type}  ${result.challenge.value}`);
                context.output.out('');
                context.output.out('Then point the hostname at Spryloom:');
                context.output.out(`  ${result.cname.name}  ${result.cname.type}  ${result.cname.value}`);
                context.output.out('');
                context.output.out(paint.dim(`When both are in place: spry domain verify ${slug} ${result.hostname}`));
                return 0;
            }
            case 'verify': {
                if (hostname === undefined)
                    return usage();
                const result = await found.client.verifyDomain(slug, hostname);
                context.output.out(`${paint.green('Verified')} ${result.hostname}. It now serves ${slug}.`);
                return 0;
            }
            case 'list': {
                const domains = await found.client.listDomains(slug);
                if (domains.length === 0) {
                    context.output.out(`${slug} has no custom domains.`);
                    return 0;
                }
                for (const d of domains) {
                    context.output.out(`  ${d.hostname}  ${d.verified ? paint.green('verified') : paint.dim('not verified')}`);
                }
                return 0;
            }
            case 'remove': {
                if (hostname === undefined)
                    return usage();
                await found.client.removeDomain(slug, hostname);
                context.output.out(`${paint.green('Removed')} ${hostname} from ${slug}.`);
                return 0;
            }
            default:
                return usage();
        }
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
// ---------------------------------------------------------------------------
// Scheduled jobs (M1*)
// ---------------------------------------------------------------------------
function when(seconds) {
    if (seconds === undefined)
        return '-';
    return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
function result(run) {
    if (run === undefined)
        return 'not run yet';
    switch (run.result) {
        case 'succeeded':
            return 'succeeded';
        case 'failed':
            return run.exitCode === undefined ? 'failed' : `failed (exit ${run.exitCode})`;
        case 'timed_out':
            return 'stopped at its time limit';
        case 'skipped':
            return 'skipped, the previous run was still going';
        case 'lost':
            return 'lost track of';
        default:
            return run.result;
    }
}
/**
 * `spry jobs <app>`, `spry jobs run <app> <job>`, `spry jobs resume <app> <job>`.
 *
 * Running by hand is how a person checks a job without waiting for its
 * schedule; resuming is what the paused-job email tells them to type.
 */
export async function jobs(context, action, slug, job) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const paint = painter(context.colour);
    const { output } = context;
    try {
        if (action === 'run' || action === 'resume') {
            if (job === undefined) {
                output.err('Which job?');
                output.err('');
                output.err(`  spry jobs ${action} ${slug} <job>`);
                return 2;
            }
            if (action === 'run') {
                await found.client.runJob(slug, job);
                output.out(`${paint.green('✓')} ${job} is running.`);
                output.out(paint.dim(`See how it went with \`spry logs ${slug} --job ${job}\`.`));
                return 0;
            }
            const resumed = await found.client.resumeJob(slug, job);
            output.out(`${paint.green('✓')} ${job} is resumed. It runs ${resumed.described}.`);
            if (resumed.nextRunAt !== undefined)
                output.out(paint.dim(`Next run: ${when(resumed.nextRunAt)}`));
            return 0;
        }
        const listed = await found.client.listJobs(slug);
        if (listed.length === 0) {
            output.out(`${slug} has no scheduled jobs.`);
            output.out(paint.dim('Add a jobs section to spryloom.yaml and publish again to give it some.'));
            return 0;
        }
        for (const one of listed) {
            output.out(paint.bold(one.name) + (one.paused ? ` ${paint.yellow('paused')}` : ''));
            for (const line of describeRows([
                ['runs', one.described],
                ['command', one.command],
                ['next run', one.paused ? `paused after ${one.consecutiveFailures} failures` : when(one.nextRunAt)],
                ['last run', one.lastRun === undefined ? 'not run yet' : `${when(one.lastRun.startedAt)}, ${result(one.lastRun)}`],
            ], paint)) {
                output.out(line);
            }
            output.out('');
        }
        if (listed.some((one) => one.paused)) {
            output.out(paint.dim('Resume a paused job with `spry jobs resume <app> <job>`, or publish again.'));
        }
        return 0;
    }
    catch (error) {
        return reportFailure(output, error);
    }
}
/** `spry logs <app> --job <job>`: a job's recent runs, and what the newest one printed. */
export async function jobLogs(context, slug, job) {
    const found = await clientFor(context);
    if (found === undefined)
        return notSignedIn(context.output);
    const paint = painter(context.colour);
    try {
        const history = await found.client.jobRuns(slug, job);
        if (history.runs.length === 0) {
            context.output.out(`${job} has not run yet.`);
            context.output.out(paint.dim(`Run it now with \`spry jobs run ${slug} ${job}\`.`));
            return 0;
        }
        for (const run of history.runs.slice(0, 10)) {
            const trigger = run.trigger === 'manual' ? ', run by hand' : '';
            context.output.out(`${when(run.startedAt)}  ${result(run)}${trigger}`);
            if (run.detail !== undefined && run.result !== 'succeeded')
                context.output.out(paint.dim(`  ${run.detail}`));
        }
        if (history.lines.length > 0) {
            context.output.out('');
            context.output.out(paint.dim('What the newest finished run printed:'));
            for (const line of history.lines)
                context.output.out(line);
        }
        return 0;
    }
    catch (error) {
        return reportFailure(context.output, error);
    }
}
//# sourceMappingURL=platform.js.map