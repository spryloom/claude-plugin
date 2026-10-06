/**
 * Signing in from inside the agent (D111).
 *
 * Someone who installs Spryloom from a plugin directory has never run
 * `spry login`, and the place they find that out is the agent, not a terminal.
 * So the server starts without a session, offers `sign_in`, and every other tool
 * says to call it first. A tool that is missing explains nothing; a tool that
 * says what to do next is one step from working.
 *
 * The sign-in is the terminal's, unchanged (D34):
 *
 *  - The person is shown a code, here by the agent, and approves only if the
 *    page their email link opens shows the same one.
 *  - The poll token stays in this process. It is never in a tool result, so it
 *    never reaches the agent's context or a transcript.
 *  - The token lands in the same file `spry login` writes, readable only by its
 *    owner, so the terminal is signed in too and the next session starts so.
 *
 * Collecting is its own call, and each call waits a bounded time, because some
 * agents end a tool call after a minute and the person may take longer than
 * that to find the email.
 */
import { HttpSpryloomClient, redact } from './http-client.js';
import { saveSession } from './session.js';
/** How long one `finish_sign_in` call waits before handing back to the agent. */
export const FINISH_WAIT_MS = 45_000;
const ok = (text) => ({ text, isError: false });
const failed = (text) => ({ text, isError: true });
/** What every other tool answers until somebody signs in. */
export const NOT_SIGNED_IN = [
    'Spryloom is not signed in on this machine yet.',
    '',
    'Ask the person which email address to sign in with, then call sign_in with it.',
    'It takes one click in their email, and only happens once on this machine.',
].join('\n');
export class Account {
    options;
    current;
    pending;
    constructor(options) {
        this.options = options;
        if (options.token !== undefined && options.token !== '') {
            this.current = this.connect(options.token);
        }
    }
    /** The client to act through, or nothing while nobody is signed in. */
    async client() {
        if (this.current === undefined && this.options.reload !== undefined) {
            const token = await this.options.reload().catch(() => undefined);
            if (token !== undefined && token !== '')
                this.current = this.connect(token);
        }
        return this.current;
    }
    /** Ask Spryloom to email a sign-in link, and say what the person must check. */
    async start(email) {
        if ((await this.client()) !== undefined) {
            // Switching account silently is how an app ends up published into a
            // workspace the person does not own. That is a terminal decision.
            return ok('Spryloom is already signed in on this machine. Carry on with what the person asked for. ' +
                'To use a different account, the person runs `spry logout` and then `spry login` in a terminal.');
        }
        let started;
        try {
            started = await new HttpSpryloomClient({
                baseUrl: this.options.baseUrl,
                fetch: this.options.fetch,
                clientVersion: this.options.clientVersion,
            }).startLogin({ email });
        }
        catch (error) {
            return failed(error instanceof Error ? error.message : String(error));
        }
        this.pending = {
            email,
            started,
            deadline: this.now() + Math.max(1, started.expiresIn) * 1000,
        };
        const minutes = describeMinutes(started.expiresIn);
        const lines = started.approveUrl === undefined
            ? [
                `Spryloom emailed a sign-in link to ${email}.`,
                '',
                'Tell the person, exactly:',
                `  Open the link from Spryloom in your email. The page shows a code. Approve only if it shows ${started.userCode}.`,
                '',
                `Then call finish_sign_in. The link works for ${minutes}.`,
            ]
            : [
                // A Spryloom running on this machine has nowhere to send mail from
                // (D55). The code still has to match; only delivery changes.
                'This Spryloom is running on this machine, so nothing was emailed.',
                '',
                'Tell the person, exactly:',
                `  Open ${started.approveUrl}. The page shows a code. Approve only if it shows ${started.userCode}.`,
                '',
                `Then call finish_sign_in. The link works for ${minutes}.`,
            ];
        return ok(lines.join('\n'));
    }
    /** Wait a bounded time for the person to approve, then sign in or say why not. */
    async finish() {
        const pending = this.pending;
        if (pending === undefined) {
            return (await this.client()) === undefined
                ? failed("No sign-in is waiting. Call sign_in with the person's email address first.")
                : ok('Spryloom is signed in. Carry on with what the person asked for.');
        }
        const { started } = pending;
        const poller = new HttpSpryloomClient({
            baseUrl: this.options.baseUrl,
            token: started.pollToken,
            fetch: this.options.fetch,
            clientVersion: this.options.clientVersion,
        });
        const intervalMs = Math.max(1, started.interval) * 1000;
        const giveBackAt = this.now() + (this.options.waitMs ?? FINISH_WAIT_MS);
        for (;;) {
            if (this.now() >= pending.deadline)
                return this.expired(pending);
            if (this.now() >= giveBackAt) {
                return ok(`Not approved yet. Ask the person whether they opened the link sent to ${pending.email} ` +
                    `and approved code ${started.userCode}. When they say they have, call finish_sign_in again.`);
            }
            await this.sleep(intervalMs);
            let response;
            try {
                response = await poller.pollLogin(started.requestId);
            }
            catch (error) {
                return failed(redact(error instanceof Error ? error.message : String(error), started.pollToken));
            }
            if (response.status === 'expired')
                return this.expired(pending);
            if (response.status !== 'complete')
                continue;
            if (typeof response.token !== 'string' || response.token === '') {
                this.pending = undefined;
                return failed('Spryloom said the sign-in was complete but did not return a token. Call sign_in again.');
            }
            const email = response.email ?? pending.email;
            const workspace = response.workspace ?? '';
            try {
                await saveSession({ baseUrl: this.options.baseUrl, token: response.token, email, workspace }, this.options.env);
            }
            catch {
                // The session still works for as long as this agent runs. Only the
                // next one, and the terminal, will have to sign in again.
            }
            this.pending = undefined;
            this.current = this.connect(response.token);
            return ok(`Signed in to Spryloom as ${email}${workspace === '' ? '' : ` (workspace ${workspace})`}. ` +
                'Tell the person, then carry on with what they asked for.');
        }
    }
    expired(pending) {
        this.pending = undefined;
        return failed(`The sign-in link sent to ${pending.email} was not approved within ` +
            `${describeMinutes(pending.started.expiresIn)}. Call sign_in again to send a new one.`);
    }
    connect(token) {
        return (this.options.connect?.(token) ??
            new HttpSpryloomClient({
                baseUrl: this.options.baseUrl,
                token,
                fetch: this.options.fetch,
                clientVersion: this.options.clientVersion,
            }));
    }
    now() {
        return (this.options.now ?? Date.now)();
    }
    sleep(ms) {
        return (this.options.sleep ?? ((t) => new Promise((r) => setTimeout(r, t))))(ms);
    }
}
function describeMinutes(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
//# sourceMappingURL=account.js.map