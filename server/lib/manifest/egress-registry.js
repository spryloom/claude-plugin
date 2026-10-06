/**
 * The outside hosts a Spryloom app may reach (D82, D83).
 *
 * The one list, in code. `docs/2026-09-22/spryloom-egress-host-registry-v1.md`
 * is the same list for people, and a test holds the two identical, so a host
 * cannot be added here without the document saying why, or the other way
 * round. Changes to this file get D16 review, like the reserved-domain list.
 *
 * The rule a host is judged by: no outside service is safe in itself. What
 * matters is whether somebody other than the publisher can own an account
 * there and receive data through it. A host joins only when it is one
 * company's fixed API, a key alone reaches it, it cannot message the public,
 * and it resolves only to the provider.
 *
 * Every workspace gets the same list in M1*. `allowedFor` takes the workspace
 * anyway, so the company registries planned for M5 can be added without the
 * proxy or the validator changing shape (D87).
 */
export const EGRESS_REGISTRY = [
    { hosts: ['api.openai.com'], service: 'OpenAI', usedFor: 'AI model calls', credential: 'API key', label: 'Sends data to OpenAI for AI processing' },
    { hosts: ['api.anthropic.com'], service: 'Anthropic', usedFor: 'AI model calls', credential: 'API key', label: 'Sends data to Anthropic for AI processing' },
    { hosts: ['generativelanguage.googleapis.com'], service: 'Google Gemini API', usedFor: 'AI model calls', credential: 'API key', label: 'Sends data to Google for AI processing' },
    { hosts: ['api.stripe.com'], service: 'Stripe', usedFor: 'Payments, invoices, customers', credential: 'Secret key', label: 'Sends payment data to Stripe' },
    { hosts: ['slack.com'], service: 'Slack Web API', usedFor: 'Posting as a bot, reading channels the bot joined', credential: 'Bot token', label: 'Reads from and posts to Slack' },
    { hosts: ['api.github.com'], service: 'GitHub REST API', usedFor: 'Issues, pull requests, repository data', credential: 'Fine-grained token', label: 'Reads from and writes to GitHub' },
    { hosts: ['api.linear.app'], service: 'Linear', usedFor: 'Issues and projects', credential: 'API key', label: 'Reads from and writes to Linear' },
    { hosts: ['api.notion.com'], service: 'Notion', usedFor: 'Pages and databases', credential: 'Integration token', label: 'Reads from and writes to Notion' },
    { hosts: ['api.airtable.com'], service: 'Airtable', usedFor: 'Bases and records', credential: 'Personal access token', label: 'Reads from and writes to Airtable' },
    { hosts: ['api.hubapi.com'], service: 'HubSpot', usedFor: 'Contacts, deals, tickets', credential: 'Private app token', label: 'Reads from and writes to HubSpot' },
    {
        hosts: ['sheets.googleapis.com', 'oauth2.googleapis.com'],
        service: 'Google Sheets, through a service account',
        usedFor: 'Reading and writing a sheet shared with the service account',
        credential: 'Service-account key',
        label: 'Reads from and writes to Google Sheets',
    },
];
/** Hosts held back for now, with the reason a refusal gives. Patterns use a leading `*.`. */
export const EGRESS_HELD = [
    {
        hosts: ['api.postmarkapp.com', 'api.resend.com', 'api.sendgrid.com', 'api.mailgun.net'],
        reason: 'it sends email to anyone. Apps email the people who use them with `email: true` instead',
    },
    { hosts: ['api.twilio.com'], reason: 'it sends SMS to anyone' },
    {
        hosts: ['hooks.slack.com', 'discord.com'],
        reason: 'anyone can create a webhook there, so an app could post its data to an account somebody else owns. For Slack, use slack.com with a bot token instead',
    },
    {
        hosts: ['webhook.site', '*.ngrok.app', '*.ngrok-free.app', '*.workers.dev', '*.vercel.app', '*.herokuapp.com', 'pastebin.com'],
        reason: 'anyone can receive data there under a name they choose',
    },
    {
        hosts: ['*.s3.amazonaws.com', '*.blob.core.windows.net', 'storage.googleapis.com'],
        reason: 'anyone can own a bucket there',
    },
    {
        hosts: ['raw.githubusercontent.com'],
        reason: 'code fetched while the app runs is a supply chain nobody reviewed. Dependencies belong in the build',
    },
    {
        hosts: ['*.atlassian.net', '*.zendesk.com', '*.my.salesforce.com', '*.webhook.office.com'],
        reason: 'each company has its own address there, and Spryloom does not allow those yet',
    },
];
/** Domains no app may reach, whatever the registry says (D6). */
const PLATFORM_DOMAINS = ['spryloom.com', 'spryloom.app'];
const byHost = new Map();
for (const entry of EGRESS_REGISTRY)
    for (const host of entry.hosts)
        byHost.set(host, entry);
function matchesPattern(host, pattern) {
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1);
        return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
}
/** The registry entry for a host, if it has one. */
export function registryEntry(host) {
    return byHost.get(host.toLowerCase().replace(/\.$/, ''));
}
/**
 * Whether an app in this workspace may reach this host.
 *
 * The workspace is unused in M1*: every workspace gets the same list. It is
 * here so the M5 company layer is a change to this function and nothing else.
 */
export function allowedFor(host, _workspace) {
    return registryEntry(host) !== undefined;
}
/** The label wording for a host, from the registry. */
export function labelFor(host) {
    const entry = registryEntry(host);
    return entry === undefined ? host : `${entry.label} (${host})`;
}
/** Where the list of allowed services is published for people. */
export const EGRESS_DOCS_URL = 'https://spryloom.com/docs/outside-apis';
/** Where a publisher asks for a host (D85). */
export const EGRESS_REQUESTS_TO = 'hello@spryloom.com';
/**
 * Why a host written in a manifest cannot be used, or undefined when it can.
 *
 * Returns the message and hint a manifest issue carries. The forms are checked
 * in the order a person is most likely to have got wrong: a URL instead of a
 * host, a pattern, an address, Spryloom itself, then the registry.
 */
export function egressProblem(written) {
    // A trailing dot is the absolute form of the same name, not a different host.
    const host = written.trim().toLowerCase().replace(/\.$/, '');
    // An address, in any form, before anything else: `::1` would otherwise read
    // as a host with a port.
    if (!host.includes('://') && (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) || host.startsWith('[') || host.split(':').length > 2)) {
        return { message: `is ${written}, and an app cannot reach an address directly.`, hint: 'Name the service by its host name.' };
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(host) || host.includes('/') || /:\d+$/.test(host) || host.includes('@')) {
        const bare = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@]*@/, '').split('/')[0]?.replace(/:\d+$/, '') ?? host;
        return { message: `is ${written}. Write the host alone, with no scheme, port or path.`, hint: `For example: - ${bare}` };
    }
    if (host.includes('*')) {
        return { message: `is ${written}. Name one exact host, not a pattern.` };
    }
    if (PLATFORM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        return { message: `is ${written}. An app cannot reach Spryloom itself or another Spryloom app.` };
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
        return { message: `is ${written}, which is not a host name.` };
    }
    const held = EGRESS_HELD.find((group) => group.hosts.some((pattern) => matchesPattern(host, pattern)));
    if (held !== undefined) {
        return {
            message: `is ${written}, which Spryloom does not allow: ${held.reason}.`,
            hint: `Apps can reach the services listed at ${EGRESS_DOCS_URL}.`,
        };
    }
    if (!allowedFor(host)) {
        return {
            message: `is ${written}, which Spryloom does not allow yet.`,
            hint: `Apps can reach the services listed at ${EGRESS_DOCS_URL}. To ask for this one, email ${EGRESS_REQUESTS_TO} with the host and what your app needs it for.`,
        };
    }
    return undefined;
}
//# sourceMappingURL=egress-registry.js.map