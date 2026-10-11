/**
 * What an app is and does, in words, from the manifest it was published with.
 *
 * Read by the founder's tools (D125): Discord says what a new app is, and
 * `pnpm ops` shows each app's profile and what people build across them. The
 * manifest is stored as JSON with each app, written by whatever version of the
 * platform published it, so this reads it tolerantly: a field that is missing
 * or the wrong shape is left out, never an error.
 */
import { describeSchedule, parseCron } from './cron.js';
/** Every feature label, in the order they are shown and counted. */
export const FEATURES = ['Database', 'File uploads', 'Saves data', 'Scheduled jobs', 'Sends email', 'Outside services', 'Google sign-in'];
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v !== '') : []);
const object = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {});
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
function when(schedule) {
    try {
        return describeSchedule(parseCron(schedule));
    }
    catch {
        return `on the schedule "${schedule}"`;
    }
}
export function summarizeManifest(raw) {
    const m = object(raw);
    const app = object(m['app']);
    const runtime = object(m['runtime']);
    const data = object(m['data']);
    const access = object(m['access']);
    const backend = text(runtime['backend']);
    const frontend = text(runtime['frontend']);
    const stackParts = [
        backend !== undefined && backend !== 'none' ? `${backend === 'node' ? 'Node' : backend} backend` : '',
        frontend !== undefined && frontend !== 'none' ? `${frontend === 'react' ? 'React' : frontend} front end` : '',
        text(runtime['dockerfile']) !== undefined ? 'own Dockerfile' : '',
    ].filter((p) => p !== '');
    const jobs = (Array.isArray(m['jobs']) ? m['jobs'] : []).map(object).flatMap((job) => {
        const name = text(job['name']);
        const schedule = text(job['schedule']);
        if (name === undefined || schedule === undefined)
            return [];
        const timezone = text(job['timezone']);
        return [{ name, when: when(schedule), ...(timezone !== undefined && { timezone }) }];
    });
    const lists = Object.keys(object(data['lists']));
    const signin = strings(access['signin']);
    const egress = strings(m['egress']);
    const postgres = data['postgres'] === true;
    const uploads = data['uploads'] === true;
    const email = m['email'] === true;
    const features = FEATURES.filter((f) => f === 'Database' ? postgres
        : f === 'File uploads' ? uploads
            : f === 'Saves data' ? lists.length > 0
                : f === 'Scheduled jobs' ? jobs.length > 0
                    : f === 'Sends email' ? email
                        : f === 'Outside services' ? egress.length > 0
                            : signin.includes('google'));
    const name = text(app['name']);
    const description = text(app['description']);
    const visibility = text(access['visibility']);
    return {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(stackParts.length > 0 && { stack: stackParts.join(', ') }),
        ...(backend !== undefined && { backend }),
        ...(frontend !== undefined && { frontend }),
        postgres,
        tables: strings(data['tables']),
        uploads,
        lists,
        jobs,
        email,
        egress,
        signin,
        ...(visibility !== undefined && { visibility }),
        features,
    };
}
//# sourceMappingURL=summary.js.map