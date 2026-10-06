/**
 * What an app may send through `POST /v1/notify` on the gateway (D86).
 *
 * One set of rules, used by the gateway before it forwards anything and again
 * by the control plane before it sends anything, so the two cannot disagree
 * about what a notification is.
 *
 * The shape is the safety. A notification is a recipient, a short subject, a
 * few lines of plain text with no web addresses in them, and at most one
 * button whose target is a page in the app itself. Spryloom writes the email
 * around it. There is nowhere to put a link to anywhere else, which is what
 * keeps a message from `hello@spryloom.com` from sending anybody to a fake
 * sign-in page (R11).
 */
export const NOTIFY_LIMITS = {
    subject: 100,
    text: 500,
    buttonLabel: 30,
    buttonPath: 200,
    dedupeKey: 100,
    address: 254,
    /** Bytes. The gateway refuses a larger body before parsing it. */
    body: 8 * 1024,
};
/** The HTTP status each refusal answers with. */
export const NOTIFY_STATUS = {
    invalid_json: 400,
    bad_field: 422,
    bad_address: 422,
    too_long: 422,
    link_in_text: 422,
    bad_button_path: 422,
    bad_key: 401,
    email_not_declared: 403,
    email_suspended: 403,
    not_a_member: 422,
    daily_limit: 429,
    unavailable: 503,
};
// Control characters other than a line break. Text may have line breaks; a
// subject, a label and a path may not.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const CONTROL_OR_NEWLINE = /[\u0000-\u001f\u007f]/;
/**
 * Anything shaped like a domain: letters or digits, a dot, and a run of two or
 * more letters. Any ending, because mail clients link far more than the common
 * ones, `.gov`, `.help`, `.tk` among them (security review, 22 September).
 *
 * This refuses some ordinary words too, such as "Node.js" or "report.pdf". That
 * is the price, paid on purpose: a message from the address sign-in links come
 * from must not be able to carry a link, and the fix for a refused word is to
 * put it on the page the button opens.
 */
const DOMAIN_SHAPED = /(^|[^a-z0-9-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?![a-z0-9-])/i;
/** Schemes that link without `//`. */
const BARE_SCHEME = /\b(javascript|data|vbscript|file|mailto|tel|sms|intent|blob):/i;
/**
 * The text as a mail client would read it: compatible characters folded, so a
 * fullwidth or ideographic dot is a dot, and invisible characters removed, so a
 * zero-width space cannot split a domain the client would join back up.
 */
function asRead(text) {
    return text
        .normalize('NFKC')
        .replace(/[\u3002\uff0e\uff61]/g, '.')
        .replace(/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g, '');
}
/**
 * The first web address in a piece of text, if there is one.
 *
 * Exported so the refusal can quote what it found. An email address on its own
 * is allowed, so a notification can say who assigned a request; one followed
 * straight away by a path or a port is treated as the link it would become.
 */
export function webAddressIn(raw) {
    const text = asRead(raw);
    const scheme = /[a-z][a-z0-9+.-]*:\/\/\S*/i.exec(text);
    if (scheme !== null)
        return scheme[0];
    const bare = BARE_SCHEME.exec(text);
    if (bare !== null)
        return text.slice(bare.index, bare.index + 40).split(/\s/)[0];
    const www = /www\.\S*/i.exec(text);
    if (www !== null)
        return www[0];
    const ip = /(^|[^\d.])(\d{1,3}\.){3}\d{1,3}(?![\d.])/.exec(text);
    if (ip !== null)
        return ip[0].replace(/^[^\d]/, '');
    const email = /[^\s@]+@((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})([/:?#]\S*)?/gi;
    for (const match of text.matchAll(email)) {
        if (match[2] !== undefined)
            return match[0];
    }
    const withoutEmails = text.replace(email, ' ');
    const domain = DOMAIN_SHAPED.exec(withoutEmails);
    if (domain !== null)
        return domain[2];
    return undefined;
}
/**
 * Whether a button path stays inside the app.
 *
 * Resolved against a stand-in origin, and accepted only when the origin does
 * not change. That catches `//evil.example`, `/\evil`, a scheme, and the
 * encoded forms of each, rather than a list of spellings someone will extend.
 */
export function buttonPathProblem(path) {
    if (!path.startsWith('/'))
        return 'must start with "/"';
    if (path.startsWith('//') || path.includes('\\'))
        return 'must be a page in this app';
    if (CONTROL_OR_NEWLINE.test(path))
        return 'must not contain control characters';
    if (/:\/\//.test(path) || /%3a%2f%2f/i.test(path) || /%2f%2f/i.test(path.slice(0, 7)))
        return 'must be a page in this app';
    try {
        const base = 'https://app.invalid';
        if (new URL(path, base).origin !== base)
            return 'must be a page in this app';
    }
    catch {
        return 'is not a path';
    }
    return undefined;
}
function looksLikeAddress(value) {
    return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}
/**
 * Check a notification. Returns the cleaned request, or the refusal to send.
 *
 * The wording of each refusal is the acceptance specification's section 5,
 * and the helper in the agent skill prints it as it arrives.
 */
export function checkNotification(input) {
    const refuse = (error, message) => ({ refused: { error, message } });
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return refuse('invalid_json', 'The body must be a JSON object with to, subject and text.');
    }
    const body = input;
    const to = body['to'];
    if (typeof to !== 'string' || to.trim() === '')
        return refuse('bad_field', 'to is required: one email address.');
    const address = to.trim().toLowerCase();
    if (address.length > NOTIFY_LIMITS.address || !looksLikeAddress(address)) {
        return refuse('bad_address', `${to} is not an email address.`);
    }
    const subject = body['subject'];
    if (typeof subject !== 'string' || subject.trim() === '')
        return refuse('bad_field', 'subject is required.');
    if (CONTROL_OR_NEWLINE.test(subject))
        return refuse('bad_field', 'subject must be one line, with no control characters.');
    if (subject.length > NOTIFY_LIMITS.subject) {
        return refuse('too_long', `subject is ${subject.length} characters. The limit is ${NOTIFY_LIMITS.subject}.`);
    }
    const text = body['text'];
    if (typeof text !== 'string' || text.trim() === '')
        return refuse('bad_field', 'text is required.');
    if (CONTROL.test(text))
        return refuse('bad_field', 'text must be plain text, with no control characters.');
    if (text.length > NOTIFY_LIMITS.text) {
        return refuse('too_long', `text is ${text.length} characters. The limit is ${NOTIFY_LIMITS.text}.`);
    }
    for (const [field, value] of [['subject', subject], ['text', text]]) {
        const found = webAddressIn(value);
        if (found !== undefined) {
            return refuse('link_in_text', `the ${field} contains a web address (${found}). Notifications cannot carry links. Use button.path to link to a page in this app.`);
        }
    }
    let button;
    const rawButton = body['button'];
    if (rawButton !== undefined && rawButton !== null) {
        if (typeof rawButton !== 'object' || Array.isArray(rawButton)) {
            return refuse('bad_field', 'button must be an object with label and path.');
        }
        const { label, path } = rawButton;
        if (typeof label !== 'string' || label.trim() === '')
            return refuse('bad_field', 'button.label is required.');
        if (CONTROL_OR_NEWLINE.test(label))
            return refuse('bad_field', 'button.label must be one line.');
        if (label.length > NOTIFY_LIMITS.buttonLabel) {
            return refuse('too_long', `button.label is ${label.length} characters. The limit is ${NOTIFY_LIMITS.buttonLabel}.`);
        }
        if (webAddressIn(label) !== undefined) {
            return refuse('link_in_text', 'button.label contains a web address. Notifications cannot carry links.');
        }
        if (typeof path !== 'string' || path === '') {
            return refuse('bad_button_path', 'button.path must be a page in this app, starting with "/", such as "/requests/42".');
        }
        if (path.length > NOTIFY_LIMITS.buttonPath) {
            return refuse('too_long', `button.path is ${path.length} characters. The limit is ${NOTIFY_LIMITS.buttonPath}.`);
        }
        if (buttonPathProblem(path) !== undefined) {
            return refuse('bad_button_path', 'button.path must be a page in this app, starting with "/", such as "/requests/42".');
        }
        button = { label: label.trim(), path };
    }
    let dedupeKey;
    const rawKey = body['dedupeKey'];
    if (rawKey !== undefined && rawKey !== null) {
        if (typeof rawKey !== 'string' || rawKey === '' || CONTROL_OR_NEWLINE.test(rawKey)) {
            return refuse('bad_field', 'dedupeKey must be a line of text.');
        }
        if (rawKey.length > NOTIFY_LIMITS.dedupeKey) {
            return refuse('too_long', `dedupeKey is ${rawKey.length} characters. The limit is ${NOTIFY_LIMITS.dedupeKey}.`);
        }
        dedupeKey = rawKey;
    }
    return {
        ok: {
            to: address,
            subject: subject.trim(),
            text: text.trim(),
            ...(button !== undefined && { button }),
            ...(dedupeKey !== undefined && { dedupeKey }),
        },
    };
}
//# sourceMappingURL=notify.js.map