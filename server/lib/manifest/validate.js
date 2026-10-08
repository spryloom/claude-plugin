import { CronError, isTimeZone, parseCron, shortestGap } from './cron.js';
import { egressProblem } from './egress-registry.js';
import { DEFAULT_SIGNIN, JOB_RULES, LIST_RULES, ManifestError, } from './types.js';
const FRONTENDS = ['react', 'static', 'none'];
const BACKENDS = ['node', 'none'];
const VISIBILITIES = ['private', 'invited', 'company', 'link'];
const SIGNIN_METHODS = ['google', 'email_link'];
/** Maximum length of a DNS label, minus room for the workspace and domain. */
const SLUG_MAX = 40;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 200;
const COMMAND_MAX = 500;
/**
 * Slugs that would collide with platform hostnames or confuse a person reading a
 * URL. An app cannot claim any of these.
 */
const RESERVED_SLUGS = new Set([
    'www', 'api', 'app', 'apps', 'admin', 'dashboard', 'auth', 'login', 'signin',
    'sign-in', 'logout', 'account', 'accounts', 'billing', 'static', 'assets',
    'cdn', 'mail', 'smtp', 'ftp', 'ns1', 'ns2', 'internal', 'status', 'support',
    'help', 'docs', 'blog', 'spryloom', 'spry', 'proxy', 'gateway', 'test',
]);
class IssueCollector {
    issues = [];
    add(path, message, hint) {
        this.issues.push(hint === undefined ? { path, message } : { path, message, hint });
    }
    get ok() {
        return this.issues.length === 0;
    }
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Turn an app name into a DNS-safe slug.
 *
 * Exported because the agent needs the same rule when it writes the manifest, so
 * that a name accepted by the CLI produces the slug the platform expects.
 */
export function deriveSlug(name) {
    const slug = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAX)
        .replace(/-+$/g, '');
    return slug;
}
/** Check a slug against the hostname rules. Returns a reason, or null when valid. */
export function slugProblem(slug) {
    if (slug.length === 0)
        return 'is empty';
    if (slug.length > SLUG_MAX)
        return `is longer than ${SLUG_MAX} characters`;
    if (!/^[a-z0-9-]+$/.test(slug))
        return 'may only contain lowercase letters, digits and hyphens';
    if (slug.startsWith('-') || slug.endsWith('-'))
        return 'may not start or end with a hyphen';
    // Checked before the general double-hyphen rule: every punycode label contains
    // "--", so the generic message would otherwise hide the real reason.
    if (slug.startsWith('xn--'))
        return 'may not start with "xn--"';
    if (slug.includes('--'))
        return 'may not contain two hyphens in a row';
    if (RESERVED_SLUGS.has(slug))
        return 'is reserved by Spryloom';
    return null;
}
/** A deliberately permissive email check: reject the clearly wrong, accept the rest. */
function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}
/** A deliberately permissive domain check for the `company` visibility setting. */
function looksLikeDomain(value) {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value);
}
function readString(source, key, path, collector, options) {
    const raw = source[key];
    if (raw === undefined || raw === null) {
        if (options.required)
            collector.add(`${path}.${key}`, 'is required.');
        return undefined;
    }
    if (typeof raw !== 'string') {
        collector.add(`${path}.${key}`, `must be text, but is ${describeType(raw)}.`);
        return undefined;
    }
    const value = raw.trim();
    if (value === '') {
        if (options.required)
            collector.add(`${path}.${key}`, 'is required and cannot be empty.');
        return undefined;
    }
    // No control characters or line breaks. Every field here is a single line, and
    // one of them (runtime.build) is written into a generated Dockerfile, where a
    // newline would let a value add its own instructions. Refused everywhere so
    // the rule cannot be forgotten at the one place it matters (C0 controls + DEL).
    if (/[\u0000-\u001f\u007f]/.test(value)) {
        collector.add(`${path}.${key}`, 'must not contain control characters or line breaks.');
        return undefined;
    }
    if (options.max !== undefined && value.length > options.max) {
        collector.add(`${path}.${key}`, `is ${value.length} characters, which is longer than the ${options.max} allowed.`);
        return undefined;
    }
    return value;
}
function readEnum(source, key, path, allowed, fallback, collector) {
    const raw = source[key];
    if (raw === undefined || raw === null)
        return fallback;
    if (typeof raw !== 'string' || !allowed.includes(raw)) {
        collector.add(`${path}.${key}`, `must be one of ${allowed.map((a) => `"${a}"`).join(', ')}.`, raw === undefined ? undefined : `Found ${JSON.stringify(raw)}.`);
        return fallback;
    }
    return raw;
}
function readBoolean(source, key, path, fallback, collector) {
    const raw = source[key];
    if (raw === undefined || raw === null)
        return fallback;
    if (typeof raw !== 'boolean') {
        collector.add(`${path}.${key}`, `must be true or false, but is ${describeType(raw)}.`);
        return fallback;
    }
    return raw;
}
function readStringArray(source, key, path, collector) {
    const raw = source[key];
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw)) {
        collector.add(`${path}.${key}`, `must be a list, but is ${describeType(raw)}.`);
        return [];
    }
    const out = [];
    raw.forEach((item, index) => {
        if (typeof item !== 'string' || item.trim() === '') {
            collector.add(`${path}.${key}[${index}]`, `must be text, but is ${describeType(item)}.`);
            return;
        }
        out.push(item.trim());
    });
    return out;
}
function describeType(value) {
    if (value === null)
        return 'empty';
    if (Array.isArray(value))
        return 'a list';
    if (typeof value === 'object')
        return 'a group of settings';
    if (typeof value === 'number')
        return `a number (${value})`;
    if (typeof value === 'boolean')
        return `${value}`;
    return typeof value;
}
function section(root, key, collector) {
    const raw = root[key];
    if (raw === undefined || raw === null)
        return {};
    if (!isRecord(raw)) {
        collector.add(key, `must be a group of settings, but is ${describeType(raw)}.`);
        return {};
    }
    return raw;
}
/**
 * Validate and normalise a parsed manifest.
 *
 * Every problem is collected before throwing, so a person fixing the file sees
 * the whole list rather than one error per attempt.
 */
export function validateManifest(input, options = {}) {
    const collector = new IssueCollector();
    if (!isRecord(input)) {
        throw new ManifestError([
            {
                path: 'spryloom.yaml',
                message: `must contain a group of settings, but is ${describeType(input)}.`,
                hint: 'Run `spry init` to write a valid manifest.',
            },
        ]);
    }
    // ---- app -------------------------------------------------------------
    const appRaw = section(input, 'app', collector);
    const name = readString(appRaw, 'name', 'app', collector, { required: true, max: NAME_MAX });
    const description = readString(appRaw, 'description', 'app', collector, {
        required: true,
        max: DESCRIPTION_MAX,
    });
    let slug = readString(appRaw, 'slug', 'app', collector, { required: false, max: SLUG_MAX });
    if (slug === undefined && name !== undefined) {
        slug = deriveSlug(name);
        if (slug === '') {
            collector.add('app.slug', 'could not be derived from the app name.', 'Add a slug made of lowercase letters, digits and hyphens.');
        }
    }
    if (slug !== undefined && slug !== '') {
        const problem = slugProblem(slug);
        if (problem !== null) {
            collector.add('app.slug', `"${slug}" ${problem}.`, 'The slug becomes part of the app\'s web address, so it has to be a valid hostname.');
        }
    }
    // ---- runtime ---------------------------------------------------------
    const runtimeRaw = section(input, 'runtime', collector);
    const frontend = readEnum(runtimeRaw, 'frontend', 'runtime', FRONTENDS, 'none', collector);
    const backend = readEnum(runtimeRaw, 'backend', 'runtime', BACKENDS, 'none', collector);
    const dockerfile = readString(runtimeRaw, 'dockerfile', 'runtime', collector, {
        required: false,
    });
    const build = readString(runtimeRaw, 'build', 'runtime', collector, { required: false, max: COMMAND_MAX });
    const start = readString(runtimeRaw, 'start', 'runtime', collector, { required: false, max: COMMAND_MAX });
    if (frontend === 'none' && backend === 'none') {
        collector.add('runtime', 'declares no frontend and no backend, so there is nothing to run.', 'Set runtime.frontend to "react" or "static", or runtime.backend to "node".');
    }
    if (backend !== 'none' && start === undefined && dockerfile === undefined) {
        collector.add('runtime.start', 'is required when the app has a backend.', 'For example: start: node server.js');
    }
    // ---- access ----------------------------------------------------------
    const accessRaw = section(input, 'access', collector);
    const visibility = readEnum(accessRaw, 'visibility', 'access', VISIBILITIES, 'private', collector);
    const domain = readString(accessRaw, 'domain', 'access', collector, { required: false });
    if (domain !== undefined && !looksLikeDomain(domain)) {
        collector.add('access.domain', `"${domain}" is not a valid email domain.`, 'For example: acme.com');
    }
    if (visibility === 'company' && domain === undefined) {
        collector.add('access.domain', 'is required when access.visibility is "company".', 'Set it to the email domain whose members should be able to use the app, for example: acme.com');
    }
    const signinRaw = readStringArray(accessRaw, 'signin', 'access', collector);
    const signin = [];
    signinRaw.forEach((method, index) => {
        if (!SIGNIN_METHODS.includes(method)) {
            collector.add(`access.signin[${index}]`, `"${method}" is not a sign-in method Spryloom supports.`, `Supported: ${SIGNIN_METHODS.join(', ')}.`);
            return;
        }
        if (!signin.includes(method))
            signin.push(method);
    });
    // What a manifest that says nothing about sign-in gets.
    //
    // This pushed `google` as well until 2026-09-19, which contradicted
    // `DEFAULT_SIGNIN` in `types.ts`, the guide, and D25. The guide tells people
    // not to declare `google`, because "naming a method that is not there would
    // make that page wrong" — and leaving it out declared it for them. The label
    // page filters to what works, so the page stayed honest; the contract the
    // person had written did not.
    if (signin.length === 0 && collector.issues.every((i) => !i.path.startsWith('access.signin'))) {
        signin.push(...DEFAULT_SIGNIN);
    }
    const adminsRaw = readStringArray(accessRaw, 'admins', 'access', collector);
    const admins = [];
    adminsRaw.forEach((email, index) => {
        const normalised = email.toLowerCase();
        if (!looksLikeEmail(normalised)) {
            collector.add(`access.admins[${index}]`, `"${email}" is not a valid email address.`);
            return;
        }
        if (!admins.includes(normalised))
            admins.push(normalised);
    });
    // ---- data ------------------------------------------------------------
    const dataRaw = section(input, 'data', collector);
    const postgres = readBoolean(dataRaw, 'postgres', 'data', false, collector);
    const uploads = readBoolean(dataRaw, 'uploads', 'data', false, collector);
    const tables = readStringArray(dataRaw, 'tables', 'data', collector);
    if (!postgres && tables.length > 0) {
        collector.add('data.tables', 'lists tables, but data.postgres is false, so the app has no database.', 'Set data.postgres to true, or remove the table list.');
    }
    if (postgres && tables.length === 0) {
        collector.add('data.tables', 'is empty, but the app has a database.', 'List the tables the app stores. Coworkers see this on the app\'s label page.');
    }
    // Refused, not accepted and ignored, because the label page believes it.
    //
    // `uploads: true` used to validate, provision nothing, and then be announced
    // twice: the publish printed "File storage created" and the app's label page
    // told every coworker "File uploads: Yes". Section 4 of the acceptance
    // specification calls that page the product's trust surface, and it was the
    // one field in the manifest capable of making it say something untrue.
    //
    // `jobs` and `egress` were refused for the same reason until M1* built them
    // (D81, D82). Uploads are still unbuilt, so they are still refused.
    if (uploads) {
        collector.add('data.uploads', 'asks for file uploads, which Spryloom does not store yet.', 'File uploads arrive in the next release. Set data.uploads to false to publish now, and keep what matters in the database.');
    }
    // A page's saved lists (D113). An app has a database for this, and a page with
    // a server isn't a page, so lists come only with no backend and no database.
    const lists = readLists(dataRaw, collector);
    if (lists !== undefined && (backend !== 'none' || postgres)) {
        collector.add('data.lists', 'is for pages, and this is an app: it has a server or a database.', 'An app keeps its data in its own database. Remove data.lists, and use data.postgres and data.tables instead.');
    }
    // ---- jobs, email and outside hosts (M1*) --------------------------------
    const jobs = readJobs(input, collector, options.now ?? Date.now());
    const email = readTopBoolean(input, 'email', collector);
    const egress = readEgress(input, collector);
    if (!collector.ok)
        throw new ManifestError(collector.issues);
    // Everything below is present, because the collector would have caught it.
    return {
        app: { name: name, slug: slug, description: description },
        runtime: {
            frontend,
            backend,
            ...(dockerfile !== undefined && { dockerfile }),
            ...(build !== undefined && { build }),
            ...(start !== undefined && { start }),
        },
        access: {
            visibility,
            ...(domain !== undefined && { domain }),
            signin,
            admins,
        },
        data: { postgres, tables, uploads, ...(lists !== undefined && { lists }) },
        jobs,
        email,
        egress,
    };
}
/**
 * A page's lists: a group of names, each `shared` or `own` (D113, spec §3.1).
 * Undefined when there are none, so a page that saves nothing says nothing.
 */
function readLists(data, collector) {
    const raw = data['lists'];
    if (raw === undefined || raw === null)
        return undefined;
    if (!isRecord(raw)) {
        collector.add('data.lists', `must be a group of list names, each shared or own, but is ${describeType(raw)}.`, 'For example:  lists: { checkouts: shared }');
        return undefined;
    }
    const entries = Object.entries(raw);
    if (entries.length === 0)
        return undefined;
    if (entries.length > LIST_RULES.maxLists) {
        collector.add('data.lists', `A page can have at most ${LIST_RULES.maxLists} lists, and this one declares ${entries.length}.`);
        return undefined;
    }
    const lists = {};
    for (const [name, mode] of entries) {
        if (!LIST_RULES.name.test(name)) {
            collector.add(`data.lists.${name}`, 'names use lowercase letters, digits and hyphens, starting with a letter, up to 40 characters.');
            continue;
        }
        if (!LIST_RULES.modes.includes(mode)) {
            collector.add(`data.lists.${name}`, 'must be shared or own.', 'shared: everyone who can open the page sees every record. own: each person sees what they saved.');
            continue;
        }
        lists[name] = mode;
    }
    return lists;
}
const JOB_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const JOB_NAME_MAX = 40;
const HOUR_MS = 3_600_000;
const EGRESS_MAX = 20;
function gapInWords(ms) {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60)
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round((minutes / 60) * 10) / 10;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
}
/**
 * The jobs an app declares.
 *
 * Every rule a scheduler would otherwise discover at 9:00 on a Monday is
 * checked here, where the person who wrote the file is still looking at it: a
 * schedule that is not cron, a time zone that does not exist, one that runs
 * more often than the limit allows (D85), and one that never runs at all.
 */
function readJobs(root, collector, now) {
    const raw = root['jobs'];
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw)) {
        collector.add('jobs', `must be a list, but is ${describeType(raw)}.`);
        return [];
    }
    if (raw.length > JOB_RULES.maxJobs) {
        collector.add('jobs', `lists ${raw.length} jobs. An app can have at most ${JOB_RULES.maxJobs}.`);
    }
    const jobs = [];
    const seen = new Set();
    raw.forEach((item, index) => {
        const path = `jobs[${index}]`;
        if (!isRecord(item)) {
            collector.add(path, `must be a group of settings, but is ${describeType(item)}.`);
            return;
        }
        const jobName = readString(item, 'name', path, collector, { required: true, max: JOB_NAME_MAX });
        const label = jobName === undefined ? path : `${path} (${jobName})`;
        if (jobName !== undefined) {
            if (!JOB_NAME.test(jobName)) {
                collector.add(`${path}.name`, `"${jobName}" may only contain lowercase letters, digits and single hyphens.`, 'For example: morning-reminder');
            }
            else if (seen.has(jobName)) {
                collector.add(`${path}.name`, `"${jobName}" is used by another job. Each job needs its own name.`);
            }
            seen.add(jobName);
        }
        const command = readString(item, 'command', path, collector, { required: false, max: COMMAND_MAX });
        if (command === undefined && !collector.issues.some((i) => i.path === `${path}.command`)) {
            collector.add(`${path}.command`, `is missing, so ${label} has nothing to run.`, 'Add the command that does the work, the way you would run it yourself. For example: command: node jobs/remind.js');
        }
        const timezone = readString(item, 'timezone', path, collector, { required: false, max: 64 }) ?? 'UTC';
        let timezoneOk = true;
        if (!isTimeZone(timezone)) {
            timezoneOk = false;
            collector.add(`${path}.timezone`, `"${timezone}" is not a time zone name.`, 'Use a name like America/New_York or Europe/London.');
        }
        let timeoutMinutes = JOB_RULES.defaultTimeoutMinutes;
        const timeoutRaw = item['timeout_minutes'];
        if (timeoutRaw !== undefined && timeoutRaw !== null) {
            if (typeof timeoutRaw !== 'number' || !Number.isInteger(timeoutRaw) || timeoutRaw < 1 || timeoutRaw > JOB_RULES.maxTimeoutMinutes) {
                collector.add(`${path}.timeout_minutes`, `must be a whole number of minutes from 1 to ${JOB_RULES.maxTimeoutMinutes}.`, `Found ${JSON.stringify(timeoutRaw)}.`);
            }
            else {
                timeoutMinutes = timeoutRaw;
            }
        }
        const schedule = readString(item, 'schedule', path, collector, { required: true, max: 100 });
        let scheduleOk = false;
        if (schedule !== undefined) {
            try {
                const parsed = parseCron(schedule);
                scheduleOk = true;
                if (timezoneOk) {
                    const minimum = JOB_RULES.minIntervalHours * HOUR_MS;
                    const closest = shortestGap(parsed, timezone, now, 500, minimum);
                    if (closest === undefined) {
                        scheduleOk = false;
                        collector.add(`${path}.schedule`, `"${schedule}" never runs.`, 'Check the day and month: a date like 30 February never comes.');
                    }
                    else if (closest.gap < minimum) {
                        scheduleOk = false;
                        collector.add(`${path}.schedule`, `"${schedule}" runs ${gapInWords(closest.gap)} apart at its closest.`, `A job can run at most once every ${JOB_RULES.minIntervalHours} hours. For example: schedule: "0 9 * * *" runs every day at 9:00.`);
                    }
                }
            }
            catch (error) {
                if (!(error instanceof CronError))
                    throw error;
                collector.add(`${path}.schedule`, error.message, 'A schedule has five parts: minute, hour, day of the month, month, day of the week. For example: "0 9 * * 1-5" is weekdays at 9:00.');
            }
        }
        if (jobName !== undefined && command !== undefined && schedule !== undefined && scheduleOk && timezoneOk) {
            jobs.push({ name: jobName, command, schedule: parseCron(schedule).source, timezone, timeoutMinutes });
        }
    });
    return jobs;
}
/** A true or false at the top of the file, where the path is the key itself. */
function readTopBoolean(root, key, collector) {
    const raw = root[key];
    if (raw === undefined || raw === null)
        return false;
    if (typeof raw !== 'boolean') {
        collector.add(key, `must be true or false, but is ${describeType(raw)}.`);
        return false;
    }
    return raw;
}
/**
 * The outside hosts an app names, each checked against the registry (D83).
 *
 * Every refusal names the host and the reason, including the ones that will
 * never be allowed, so nobody waits for an answer that is already no.
 */
function readEgress(root, collector) {
    const raw = root['egress'];
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw)) {
        collector.add('egress', `must be a list of host names, but is ${describeType(raw)}.`, 'For example:\n    egress:\n      - api.stripe.com');
        return [];
    }
    if (raw.length > EGRESS_MAX) {
        collector.add('egress', `lists ${raw.length} hosts. An app can name at most ${EGRESS_MAX}.`);
    }
    const hosts = [];
    raw.forEach((item, index) => {
        const path = `egress[${index}]`;
        if (typeof item !== 'string' || item.trim() === '') {
            collector.add(path, `must be a host name, but is ${describeType(item)}.`);
            return;
        }
        const problem = egressProblem(item);
        if (problem !== undefined) {
            collector.add(path, problem.message, problem.hint);
            return;
        }
        const host = item.trim().toLowerCase().replace(/\.$/, '');
        if (!hosts.includes(host))
            hosts.push(host);
    });
    return hosts;
}
//# sourceMappingURL=validate.js.map