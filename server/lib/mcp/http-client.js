/**
 * The `SpryloomClient` that actually talks to the control plane.
 *
 * Everything here is one side of the contract in `@spryloom/protocol`; the
 * shapes and the paths come from there so this file cannot drift from the
 * server. What it adds is the part a wire format cannot express: a timeout on
 * every request, a readable sentence for every failure, and the promise that a
 * token never reaches an error message or a log line (CLAUDE.md, "never in a
 * log line").
 *
 * `fetch` is injectable so the tests drive it without a server, which is the
 * same reason `SpryloomClient` exists at all.
 */
import { Buffer } from 'node:buffer';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { AUTH_HEADER, CLIENT_HEADER, POLL_AUTH, PUBLISH_CONTENT_TYPE, errorCodes, isApiError, routes, } from '../protocol/index.js';
import { SpryloomFailure, } from './client.js';
/** Long enough for a slow network, short enough that a hung request is not forever. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * Sending the archive. A publish no longer waits for its build inside one
 * request (D99), so this covers only the upload of up to 100 MB.
 */
export const PUBLISH_TIMEOUT_MS = 300_000;
/** How often a running publish or delete is read: every second, then every two after a minute. */
export const WATCH_INTERVAL_MS = 1_000;
export const WATCH_SLOW_INTERVAL_MS = 2_000;
/** After this long, watching stops. The work does not. */
export const WATCH_GIVE_UP_MS = 20 * 60_000;
/** Unreachable for this long while watching, and the watcher says so rather than guessing. */
export const WATCH_LOST_CONTACT_MS = 60_000;
/** Read fresh each time: watching awaits between checks, and the answer can change. */
const aborted = (signal) => signal?.aborted === true;
const pause = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
    }, { once: true });
});
/** What an operation's failure says, as the failure a caller already knows how to show. */
function failureOf(operation) {
    const error = operation.error;
    return new SpryloomFailure({
        reason: error?.error ?? (operation.kind === 'publish' ? errorCodes.publishFailed : errorCodes.deleteFailed),
        message: error?.message ?? `The ${operation.kind} of ${operation.app} did not finish.`,
        hint: error?.hint ?? '',
        previousVersionIntact: error?.unchanged ?? false,
        logs: error?.logs ?? [],
    });
}
/**
 * The scheme every token travels under.
 *
 * Derived from `POLL_AUTH` rather than written out, because the protocol says
 * the sign-in poll token is a bearer token and the API token is the same, so
 * there is one place for both to change.
 */
const AUTH_SCHEME = `${POLL_AUTH.charAt(0).toUpperCase()}${POLL_AUTH.slice(1)}`;
export class HttpSpryloomClient {
    baseUrl;
    token;
    fetchImpl;
    timeoutMs;
    clientVersion;
    watchIntervalMs;
    constructor(options) {
        this.baseUrl = trimTrailingSlash(options.baseUrl);
        this.token = options.token;
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.clientVersion = options.clientVersion;
        this.watchIntervalMs = options.watchIntervalMs;
    }
    /**
     * Who is signed in.
     *
     * Every failure answers `undefined` rather than throwing, because the caller
     * asks this to decide whether to say "not signed in", and a network hiccup
     * should produce that sentence rather than a stack trace.
     */
    async currentUser() {
        if (this.token === undefined || this.token === '')
            return undefined;
        try {
            const response = await this.send({ method: 'GET', path: routes.whoAmI() });
            if (!response.ok)
                return undefined;
            const body = await readJson(response);
            if (body === undefined ||
                typeof body.email !== 'string' ||
                typeof body.workspace !== 'string' ||
                body.workspace === '') {
                return undefined;
            }
            return {
                email: body.email,
                workspace: body.workspace,
                ...(typeof body.domain === 'string' && body.domain !== '' ? { domain: body.domain } : {}),
            };
        }
        catch {
            return undefined;
        }
    }
    async publish(request, watch = {}) {
        const slug = request.manifest.app.slug;
        const archive = await packDirectory(request.root);
        watch.onPacked?.(archive.length);
        // The caller says where the publish came from; guessing here would make the
        // Release 1 exit metric — the share arriving by agent — quietly wrong (D15).
        const query = { publishId: request.publishId, source: request.source };
        const response = await this.send({
            method: 'POST',
            path: routes.publish(slug),
            query: { publishId: query.publishId, source: query.source },
            body: archive,
            contentType: PUBLISH_CONTENT_TYPE,
            timeoutMs: PUBLISH_TIMEOUT_MS,
        });
        const operation = await this.acceptedOperation(response, { subject: `publish "${slug}"`, fallbackReason: errorCodes.publishFailed }, watch);
        if (operation.kind !== 'publish') {
            throw new SpryloomFailure({
                reason: errorCodes.busy,
                message: `${slug} is being deleted, so it cannot be published until that finishes.`,
                hint: 'Check with `spry apps`, then publish again.',
            });
        }
        const finished = await this.watchOperation(operation, watch);
        if (finished.status !== 'succeeded' || finished.result === undefined)
            throw failureOf(finished);
        const result = finished.result;
        return {
            url: result.url,
            version: result.version,
            workspace: result.workspace,
            created: result.created ?? [],
            buildSeconds: result.buildSeconds ?? 0,
            warnings: (result.warnings ?? []),
        };
    }
    /**
     * The operation a publish or a delete started, or the one of that app already
     * running, which is then watched instead of starting a second.
     */
    async acceptedOperation(response, context, watch) {
        if (response.status === 409) {
            // A copy: a 409 without an operation (an app with nothing to start) is
            // an ordinary refusal, and its body is still needed to say why.
            const body = await readJson(response.clone());
            if (body?.operation !== undefined) {
                watch.onAttach?.(body.operation);
                return body.operation;
            }
        }
        if (!response.ok) {
            throw await this.toFailure(response, context);
        }
        const body = await readJson(response);
        if (body?.operation === undefined) {
            throw new SpryloomFailure({
                reason: context.fallbackReason,
                message: `Spryloom accepted the request to ${context.subject} but did not say how to follow it.`,
                hint: 'Run `spry apps` to see where it got to.',
                previousVersionIntact: false,
            });
        }
        return body.operation;
    }
    /**
     * Read an operation until it finishes.
     *
     * Only a failure the platform reports is a failure. A dropped connection is
     * retried, and only after a minute without any answer does this say it lost
     * contact, because the work may well be finishing without us (finding F2).
     */
    async watchOperation(operation, watch = {}) {
        const started = Date.now();
        let lastContact = Date.now();
        let current = operation;
        const doing = current.kind;
        watch.onProgress?.(current);
        while (current.status === 'accepted' || current.status === 'running') {
            if (aborted(watch.signal)) {
                throw new SpryloomFailure({
                    reason: 'stopped_watching',
                    message: 'Stopped watching.',
                    hint: `The ${doing} carries on: see it with \`spry apps\`.`,
                    previousVersionIntact: true,
                });
            }
            if (Date.now() - started > WATCH_GIVE_UP_MS) {
                throw new SpryloomFailure({
                    reason: 'stopped_watching',
                    message: `Stopped watching after ${Math.round(WATCH_GIVE_UP_MS / 60_000)} minutes. The ${doing} is still going (${current.id}).`,
                    hint: 'Check with `spry apps`.',
                    previousVersionIntact: true,
                });
            }
            await pause(this.watchIntervalMs ?? (Date.now() - started < 60_000 ? WATCH_INTERVAL_MS : WATCH_SLOW_INTERVAL_MS), watch.signal);
            if (aborted(watch.signal))
                continue;
            try {
                const response = await this.send({ method: 'GET', path: routes.operation(current.id), timeoutMs: 15_000 });
                if (response.ok) {
                    const body = await readJson(response);
                    if (body?.operation !== undefined) {
                        current = body.operation;
                        lastContact = Date.now();
                        watch.onProgress?.(current);
                    }
                    continue;
                }
                if (response.status < 500) {
                    throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `follow the ${doing}` });
                }
            }
            catch (error) {
                if (error instanceof SpryloomFailure && error.reason !== 'unreachable' && error.reason !== 'timeout')
                    throw error;
            }
            if (Date.now() - lastContact > WATCH_LOST_CONTACT_MS) {
                throw new SpryloomFailure({
                    reason: 'lost_contact',
                    message: `Lost contact with Spryloom while watching. The ${doing} may still finish.`,
                    hint: 'Check with `spry apps`.',
                    previousVersionIntact: true,
                });
            }
        }
        return current;
    }
    async listApps() {
        const response = await this.send({ method: 'GET', path: routes.apps() });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: 'list your apps',
            });
        }
        const body = await readJson(response);
        return body?.apps === undefined ? [] : body.apps.map((app) => ({ ...app }));
    }
    async status(slug) {
        const response = await this.send({ method: 'GET', path: routes.app(slug) });
        if (response.status === 404)
            return undefined;
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `read the status of "${slug}"`,
            });
        }
        const body = await readJson(response);
        if (body === undefined || typeof body.url !== 'string') {
            throw new SpryloomFailure({
                reason: errorCodes.invalid,
                message: `Spryloom returned something other than an app for "${slug}".`,
                hint: 'Try again in a moment.',
            });
        }
        return {
            url: body.url,
            version: body.version,
            live: body.live === true,
            archived: body.archived === true,
            users: body.users,
            sharedWith: body.sharedWith,
            // Seconds since epoch, straight through: how a date reads is the caller's
            // decision, not the transport's.
            lastPublishedAt: body.lastPublishedAt,
            ...(body.kind === 'page' && { kind: 'page' }),
        };
    }
    async exportApp(slug) {
        const response = await this.send({ method: 'GET', path: routes.exportApp(slug) });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `export "${slug}"`,
            });
        }
        const body = await readJson(response);
        if (body === undefined) {
            throw new SpryloomFailure({ reason: errorCodes.invalid, message: 'Spryloom returned an empty export.', hint: 'Try again in a moment.' });
        }
        return body;
    }
    async logs(slug, lines) {
        const response = await this.send({
            method: 'GET',
            path: routes.logs(slug),
            query: { lines: String(lines) },
        });
        if (response.status === 404)
            return [];
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `read the logs of "${slug}"`,
            });
        }
        const body = await readJson(response);
        return body?.lines ?? [];
    }
    async rollback(slug, toVersion, watch = {}) {
        const request = toVersion === undefined ? {} : { toVersion };
        const response = await this.send({
            method: 'POST',
            path: routes.rollback(slug),
            body: JSON.stringify(request),
            contentType: 'application/json',
        });
        return this.lifecycle(response, `roll back "${slug}"`, errorCodes.rollbackFailed, watch);
    }
    /**
     * A rollback, restore or restart (D99): accepted at once, then watched until
     * the version it brings up answers.
     */
    async lifecycle(response, subject, fallbackReason, watch) {
        const operation = await this.acceptedOperation(response, { subject, fallbackReason }, watch);
        const finished = await this.watchOperation(operation, watch);
        if (finished.status !== 'succeeded' || finished.outcome === undefined)
            throw failureOf(finished);
        return { version: finished.outcome.version, url: finished.outcome.url };
    }
    /** Revoke this terminal's token. A token that already no longer works counts as signed out. */
    async signOut() {
        const response = await this.send({ method: 'DELETE', path: routes.signOut() });
        if (response.ok || response.status === 401)
            return;
        throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: 'sign out' });
    }
    async signOutEverywhere() {
        const response = await this.send({ method: 'DELETE', path: routes.signOutEverywhere() });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: 'sign out everywhere',
            });
        }
        return (await readJson(response))?.revoked ?? 0;
    }
    /**
     * Delete an app and everything made for it.
     *
     * The name goes in twice on purpose. One of them is the app being addressed
     * and the other is the caller saying which app it believes that is, and a
     * delete is the one operation where being one argument out is unrecoverable.
     */
    async deleteApp(slug, watch = {}) {
        const response = await this.send({ method: 'DELETE', path: routes.deleteApp(slug, slug) });
        const operation = await this.acceptedOperation(response, { subject: `delete "${slug}"`, fallbackReason: errorCodes.invalid }, watch);
        const finished = await this.watchOperation(operation, watch);
        if (finished.status !== 'succeeded')
            throw failureOf(finished);
        return { deleted: slug, removed: finished.removed ?? [] };
    }
    async restart(slug, watch = {}) {
        const response = await this.send({ method: 'POST', path: routes.restart(slug) });
        await this.lifecycle(response, `restart "${slug}"`, errorCodes.invalid, watch);
    }
    async addDomain(slug, hostname) {
        const response = await this.send({
            method: 'POST', path: routes.domains(slug),
            body: JSON.stringify({ hostname }), contentType: 'application/json',
        });
        if (!response.ok) {
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `add a domain to "${slug}"` });
        }
        const body = await readJson(response);
        if (body === undefined)
            throw new Error('The server did not describe the domain.');
        return body;
    }
    async verifyDomain(slug, hostname) {
        const response = await this.send({ method: 'POST', path: routes.domainVerify(slug, hostname) });
        if (!response.ok) {
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `verify "${hostname}"` });
        }
        return (await readJson(response)) ?? { hostname, verified: false };
    }
    async listDomains(slug) {
        const response = await this.send({ method: 'GET', path: routes.domains(slug) });
        if (!response.ok) {
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `list the domains of "${slug}"` });
        }
        return (await readJson(response))?.domains ?? [];
    }
    async removeDomain(slug, hostname) {
        const response = await this.send({ method: 'DELETE', path: routes.domain(slug, hostname) });
        if (!response.ok) {
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `remove "${hostname}"` });
        }
    }
    async listSecrets(slug) {
        const response = await this.send({ method: 'GET', path: routes.secrets(slug) });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `read the secrets of "${slug}"`,
            });
        }
        return (await readJson(response))?.secrets ?? [];
    }
    async setSecret(slug, name, value) {
        const request = { value };
        const response = await this.send({
            method: 'PUT',
            path: routes.secret(slug, name),
            body: JSON.stringify(request),
            contentType: 'application/json',
        });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `set ${name} on "${slug}"`,
            });
        }
    }
    async removeSecret(slug, name) {
        const response = await this.send({ method: 'DELETE', path: routes.secret(slug, name) });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `remove ${name} from "${slug}"`,
            });
        }
    }
    async invite(slug, emails) {
        const request = { emails };
        const response = await this.send({
            method: 'POST',
            path: routes.invite(slug),
            body: JSON.stringify(request),
            contentType: 'application/json',
        });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `invite people to "${slug}"`,
            });
        }
        const body = await readJson(response);
        return { invited: body?.invited ?? [], skipped: body?.skipped ?? [], resent: body?.resent ?? [] };
    }
    async revokeInvite(slug, email) {
        const response = await this.send({ method: 'DELETE', path: routes.revokeInvite(slug, email) });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: `remove ${email} from "${slug}"`,
            });
        }
        return (await readJson(response)) ?? { revoked: true, email };
    }
    /**
     * Take an app out of service.
     *
     * A 204 and nothing else: there is no state to report back, and an app that
     * was not there is a failure rather than a quiet success, because the caller
     * asked for a specific app to stop serving.
     */
    async archive(slug) {
        const response = await this.send({ method: 'POST', path: routes.archive(slug) });
        if (response.ok)
            return;
        throw await this.toFailure(response, {
            fallbackReason: errorCodes.invalid,
            subject: `archive "${slug}"`,
        });
    }
    async restore(slug, watch = {}) {
        const response = await this.send({ method: 'POST', path: routes.restore(slug) });
        return this.lifecycle(response, `restore "${slug}"`, errorCodes.invalid, watch);
    }
    // -------------------------------------------------------------------------
    // Scheduled jobs (M1*)
    // -------------------------------------------------------------------------
    async listJobs(slug) {
        const response = await this.send({ method: 'GET', path: routes.jobs(slug) });
        if (!response.ok)
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `list the jobs of "${slug}"` });
        return (await readJson(response))?.jobs ?? [];
    }
    async runJob(slug, job) {
        const response = await this.send({ method: 'POST', path: routes.jobRun(slug, job) });
        if (!response.ok)
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `run ${job} of "${slug}"` });
        const body = await readJson(response);
        if (body === undefined)
            throw new SpryloomFailure({ reason: errorCodes.invalid, message: 'Spryloom did not say whether the job started.', hint: 'Run `spry jobs` to see.' });
        return body.run;
    }
    async resumeJob(slug, job) {
        const response = await this.send({ method: 'POST', path: routes.jobResume(slug, job) });
        if (!response.ok)
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `resume ${job} of "${slug}"` });
        const body = await readJson(response);
        if (body === undefined)
            throw new SpryloomFailure({ reason: errorCodes.invalid, message: 'Spryloom did not say whether the job resumed.', hint: 'Run `spry jobs` to see.' });
        return body;
    }
    async jobRuns(slug, job) {
        const response = await this.send({ method: 'GET', path: routes.jobRuns(slug, job) });
        if (!response.ok)
            throw await this.toFailure(response, { fallbackReason: errorCodes.invalid, subject: `read the runs of ${job} in "${slug}"` });
        return (await readJson(response)) ?? { runs: [], lines: [] };
    }
    // -------------------------------------------------------------------------
    // Sending
    // -------------------------------------------------------------------------
    async send(options) {
        const url = this.urlFor(options.path, options.query);
        const timeoutMs = options.timeoutMs ?? this.timeoutMs;
        const token = this.token;
        const headers = { accept: 'application/json' };
        if (token !== undefined && token !== '')
            headers[AUTH_HEADER] = `${AUTH_SCHEME} ${token}`;
        if (options.contentType !== undefined)
            headers['content-type'] = options.contentType;
        if (this.clientVersion !== undefined)
            headers[CLIENT_HEADER] = `spry/${this.clientVersion}`;
        try {
            return await this.fetchImpl(url, {
                method: options.method,
                headers,
                signal: AbortSignal.timeout(timeoutMs),
                ...(options.body === undefined ? {} : { body: options.body }),
            });
        }
        catch (cause) {
            throw this.transportError(cause, options.method, options.path, timeoutMs);
        }
    }
    urlFor(path, query) {
        const search = new URLSearchParams(query ?? {}).toString();
        return `${this.baseUrl}${path}${search === '' ? '' : `?${search}`}`;
    }
    /**
     * A timeout is the common case and reads as an abort, which explains nothing
     * on its own. Every transport failure becomes a sentence naming the request.
     */
    transportError(cause, method, path, timeoutMs) {
        if (isAbort(cause)) {
            return new Error(`Spryloom did not answer ${method} ${path} within ${describeDuration(timeoutMs)}. ` +
                'Check the connection and try again.');
        }
        const detail = this.scrub(describeCause(cause));
        return new Error(`Could not reach Spryloom for ${method} ${path}: ${detail}`);
    }
    /**
     * Turn a failure response into a `SpryloomFailure` the agent can read aloud.
     *
     * Every method goes through here, so `reason` and `hint` survive whatever the
     * call was and a caller can branch on the code rather than the sentence.
     */
    async toFailure(response, context) {
        const body = await readErrorBody(response);
        if (isApiError(body)) {
            const hint = typeof body.hint === 'string' && body.hint !== '' ? body.hint : defaultHint(body.error);
            return new SpryloomFailure({
                reason: body.error,
                message: this.scrub(body.message),
                hint: this.scrub(hint),
                ...(typeof body.unchanged === 'boolean' ? { previousVersionIntact: body.unchanged } : {}),
            });
        }
        const reason = reasonForStatus(response.status) ?? context.fallbackReason;
        return new SpryloomFailure({
            reason,
            message: this.scrub(describeResponse(response, body, context.subject)),
            hint: defaultHint(reason),
        });
    }
    /**
     * Belt and braces: nothing we build contains the token, and if a server ever
     * echoes it back, it still does not reach the user's terminal.
     */
    scrub(text) {
        return redact(text, this.token);
    }
    // -------------------------------------------------------------------------
    // Signing in
    //
    // Not part of `SpryloomClient`: these are the two calls made before there is
    // a token. They live here so they get the same timeout, headers and wording
    // as everything else, and `signIn` below is the shape a caller wants.
    // -------------------------------------------------------------------------
    async startLogin(request) {
        const response = await this.send({
            method: 'POST',
            path: routes.loginStart(),
            body: JSON.stringify(request),
            contentType: 'application/json',
        });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: 'start the sign-in',
            });
        }
        const body = await readJson(response);
        if (body === undefined ||
            typeof body.requestId !== 'string' ||
            typeof body.pollToken !== 'string') {
            throw new Error('Spryloom did not start the sign-in. Try again in a moment.');
        }
        return body;
    }
    async pollLogin(requestId) {
        const response = await this.send({ method: 'GET', path: routes.loginPoll(requestId) });
        if (!response.ok) {
            throw await this.toFailure(response, {
                fallbackReason: errorCodes.invalid,
                subject: 'wait for the sign-in',
            });
        }
        const body = await readJson(response);
        if (body === undefined || typeof body.status !== 'string') {
            throw new Error('Spryloom answered the sign-in check with something unreadable.');
        }
        return body;
    }
}
/**
 * Sign in from a terminal: ask, then wait for the person to click the link.
 *
 * Not part of `SpryloomClient` because it is the one call made before there is
 * a token, so it has nothing in common with the rest of the client.
 */
export async function signIn(options) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = options.now ?? (() => Date.now());
    const baseUrl = trimTrailingSlash(options.baseUrl);
    const request = { email: options.email };
    const started = await new HttpSpryloomClient({ baseUrl, fetch: fetchImpl }).startLogin(request);
    if (started.userCode !== undefined && started.userCode !== '') {
        options.onCode?.(started.userCode, started.approveUrl);
    }
    const intervalMs = Math.max(1, started.interval) * 1000;
    const deadline = now() + Math.max(1, started.expiresIn) * 1000;
    const poller = new HttpSpryloomClient({ baseUrl, token: started.pollToken, fetch: fetchImpl });
    for (;;) {
        if (now() >= deadline)
            throw expiredError(options.email, started.expiresIn, started.pollToken);
        await sleep(intervalMs);
        const response = await poller.pollLogin(started.requestId);
        if (response.status === 'complete') {
            if (typeof response.token !== 'string' || response.token === '') {
                throw new Error('Spryloom said the sign-in was complete but did not return a token. Try signing in again.');
            }
            return {
                token: response.token,
                workspace: response.workspace ?? '',
                email: response.email ?? options.email,
            };
        }
        if (response.status === 'expired') {
            throw expiredError(options.email, started.expiresIn, started.pollToken);
        }
        if (now() >= deadline)
            throw expiredError(options.email, started.expiresIn, started.pollToken);
    }
}
function expiredError(email, expiresIn, pollToken) {
    return new Error(redact(`The sign-in link sent to ${email} was not opened within ${describeDuration(expiresIn * 1000)}. ` +
        'Run `spry login` again to get a new link.', pollToken));
}
// ---------------------------------------------------------------------------
// Reading a response
// ---------------------------------------------------------------------------
async function readJson(response) {
    const text = await response.text().catch(() => '');
    if (text.trim() === '')
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/** Returns the parsed `ApiError` when there is one, otherwise the raw text. */
async function readErrorBody(response) {
    const text = await response.text().catch(() => '');
    if (text.trim() === '')
        return '';
    try {
        const parsed = JSON.parse(text);
        if (isApiError(parsed))
            return parsed;
    }
    catch {
        // Not JSON. The text itself is the best evidence we have.
    }
    return text;
}
/** A sentence for a failure that arrived without a usable body. */
function describeResponse(response, body, subject) {
    const status = `${response.status}${response.statusText === '' ? '' : ` ${response.statusText}`}`;
    const detail = typeof body === 'string' ? firstLine(body) : '';
    const because = detail === '' ? '' : ` It said: ${detail}`;
    return `Spryloom could not ${subject} (HTTP ${status}).${because}`;
}
function firstLine(text) {
    const line = text.trim().split('\n')[0] ?? '';
    return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
function reasonForStatus(status) {
    switch (status) {
        case 401:
        case 403:
            return status === 401 ? errorCodes.notSignedIn : errorCodes.notAllowed;
        case 404:
            return errorCodes.notFound;
        case 413:
            return errorCodes.tooLarge;
        case 429:
            return errorCodes.rateLimited;
        default:
            return undefined;
    }
}
/** What to do, when the server did not say. Never empty, so no "undefined". */
function defaultHint(reason) {
    switch (reason) {
        case errorCodes.notSignedIn:
            return 'Run `spry login` and try again.';
        case errorCodes.notAllowed:
            return 'Ask an admin of the workspace for access.';
        case errorCodes.notFound:
            return 'Check the app name with `spry apps`.';
        case errorCodes.tooLarge:
            return 'Remove build output and large files from the folder, then publish again.';
        case errorCodes.rateLimited:
            return 'Wait a minute and try again.';
        default:
            return 'Try again. If it keeps happening, the message above is what Spryloom reported.';
    }
}
function describeCause(cause) {
    if (cause instanceof Error)
        return cause.message === '' ? cause.name : cause.message;
    if (typeof cause === 'string' && cause !== '')
        return cause;
    return 'the connection failed';
}
function isAbort(cause) {
    if (typeof cause !== 'object' || cause === null)
        return false;
    const name = cause.name;
    return name === 'TimeoutError' || name === 'AbortError';
}
function describeDuration(ms) {
    if (ms < 1000)
        return `${ms} ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 120)
        return `${seconds} second${seconds === 1 ? '' : 's'}`;
    return `${Math.round(seconds / 60)} minutes`;
}
function trimTrailingSlash(url) {
    return url.replace(/\/+$/, '');
}
export function redact(text, secret) {
    if (secret === undefined || secret === '')
        return text;
    return text.split(secret).join('[redacted]');
}
// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------
const BLOCK = 512;
const gzipAsync = promisify(gzip);
/**
 * A gzipped tar of a folder, written here rather than shelled out.
 *
 * Spawning `tar` would be shorter, but the exclusions would then depend on
 * which `tar` is installed, and this is the code that decides whether a `.env`
 * leaves the machine. A file name with spaces, quotes or a newline is just
 * bytes in a header here, so there is no quoting to get wrong.
 */
export async function packDirectory(root) {
    const blocks = [];
    await appendDirectory(root, '', blocks);
    blocks.push(Buffer.alloc(BLOCK * 2));
    const gzipped = await gzipAsync(Buffer.concat(blocks));
    return new Uint8Array(gzipped);
}
async function appendDirectory(root, prefix, blocks) {
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        if (isExcluded(entry.name))
            continue;
        const relative = prefix === '' ? entry.name : posix.join(prefix, entry.name);
        const absolute = join(root, relative);
        if (entry.isDirectory()) {
            const info = await stat(absolute);
            blocks.push(header(`${relative}/`, 0, mtimeOf(info.mtimeMs), '5', 0o755));
            await appendDirectory(root, relative, blocks);
        }
        else if (entry.isFile()) {
            const info = await stat(absolute);
            const contents = await readFile(absolute);
            blocks.push(header(relative, contents.length, mtimeOf(info.mtimeMs), '0', info.mode));
            blocks.push(contents);
            const remainder = contents.length % BLOCK;
            if (remainder !== 0)
                blocks.push(Buffer.alloc(BLOCK - remainder));
        }
        // Symbolic links, sockets and devices are left out: nothing a published app
        // needs, and following them is a way out of the folder being published.
    }
}
/**
 * What never belongs in a published app, at any depth.
 *
 * `node_modules` and `.git` are noise; anything starting `.env` and the
 * credential files below are secrets that must not leave the machine. The list
 * is deliberately specific rather than "all dotfiles", so an app that ships a
 * real `.dockerignore` or `.npmrc-less` config still publishes.
 *
 * Framework build output is left out too: Spryloom builds the app itself, so a
 * `.next` folder from building on the laptop is only weight (finding F6, 29 MB
 * of a Next.js app's 29 MB upload). `dist` and `build` stay, because a static
 * app may ship them as they are.
 */
const EXCLUDED_NAMES = new Set([
    'node_modules', '.git', '.ssh', '.aws', '.gnupg', '.netrc',
    '.npmrc', '.git-credentials', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.vercel',
]);
function isExcluded(name) {
    return EXCLUDED_NAMES.has(name) || name.startsWith('.env');
}
function mtimeOf(milliseconds) {
    return Math.max(0, Math.floor(milliseconds / 1000));
}
function header(name, size, mtime, type, mode) {
    const block = Buffer.alloc(BLOCK);
    const { prefix, filename } = splitName(name);
    block.write(filename, 0, 100, 'utf8');
    block.write(octal(mode & 0o7777, 7), 100, 8, 'utf8');
    block.write(octal(0, 7), 108, 8, 'utf8');
    block.write(octal(0, 7), 116, 8, 'utf8');
    block.write(octal(size, 11), 124, 12, 'utf8');
    block.write(octal(mtime, 11), 136, 12, 'utf8');
    block.write('        ', 148, 8, 'utf8');
    block.write(type, 156, 1, 'utf8');
    block.write('ustar\0' + '00', 257, 8, 'utf8');
    block.write('spryloom', 265, 32, 'utf8');
    block.write('spryloom', 297, 32, 'utf8');
    if (prefix !== '')
        block.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const byte of block)
        sum += byte;
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    return block;
}
/** ustar keeps long names in two fields; a name too long for both is refused. */
function splitName(name) {
    if (Buffer.byteLength(name) <= 100)
        return { prefix: '', filename: name };
    let boundary = -1;
    for (let i = Math.max(0, name.length - 101); i < name.length; i += 1) {
        if (name[i] === '/') {
            boundary = i;
            break;
        }
    }
    const prefix = boundary > 0 ? name.slice(0, boundary) : '';
    const filename = boundary > 0 ? name.slice(boundary + 1) : name;
    if (prefix === '' || Buffer.byteLength(prefix) > 155 || Buffer.byteLength(filename) > 100) {
        throw new Error(`"${name}" has a path too long to publish (255 bytes at most). Shorten the folder names.`);
    }
    return { prefix, filename };
}
function octal(value, width) {
    return `${Math.max(0, Math.floor(value)).toString(8).padStart(width, '0')}\0`;
}
//# sourceMappingURL=http-client.js.map