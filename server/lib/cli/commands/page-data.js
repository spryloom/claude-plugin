/**
 * `spry data`: a page's saved data, from the terminal (D113, spec §8.4, §10.3).
 *
 *   spry data <page>           its lists, how many records each, and the space used
 *   spry data export <page>    every record, as JSON and CSV per list, into ./<page>-data
 *   spry data log <page>       who read its data from outside the page: exports and agents
 *
 * A page is its name in your workspace, or its address. Export is for the
 * page's owner and admins, and is recorded in the audit log.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpSpryloomClient, SpryloomFailure, pageAddress } from '../../mcp/index.js';
import { baseUrlFrom, loadSession } from '../session.js';
const MB = 1024 * 1024;
const size = (bytes) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);
async function connect(context, page) {
    const baseUrl = baseUrlFrom();
    const session = await loadSession(baseUrl);
    if (session === undefined) {
        context.output.err('Not signed in. Run `spry login` first.');
        return 1;
    }
    const client = new HttpSpryloomClient({ baseUrl, token: session.token, clientVersion: context.version });
    const user = await client.currentUser();
    if (user === undefined) {
        context.output.err('Not signed in. Run `spry login` first.');
        return 1;
    }
    const address = pageAddress(page, user.workspace);
    if (address === undefined) {
        context.output.err(`"${page}" isn't a page. Give its name in your workspace, or its address.`);
        return 2;
    }
    return { client, address };
}
const failure = (output, error) => {
    if (error instanceof SpryloomFailure) {
        output.err(error.message);
        if (error.hint !== '')
            output.err(error.hint);
        return 1;
    }
    throw error;
};
export async function showPageData(context, page) {
    const connected = await connect(context, page);
    if (typeof connected === 'number')
        return connected;
    try {
        const answer = (await connected.client.pageData(connected.address, { action: 'summary' }));
        const lists = answer.lists ?? [];
        if (lists.length === 0) {
            context.output.out(`${connected.address.slug} saves no data. Lists are declared in spryloom.yaml under data.lists.`);
            return 0;
        }
        context.output.out(`${connected.address.slug} saves data in:`);
        const width = Math.max(...lists.map((l) => l.name.length));
        for (const list of lists) {
            const who = list.mode === 'own' ? 'each person sees their own' : 'everyone sees every record';
            context.output.out(`  ${list.name.padEnd(width)}  ${String(list.records).padStart(6)} ${list.records === 1 ? 'record ' : 'records'}  ${who}`);
        }
        context.output.out(`Using ${size(answer.bytes ?? 0)} of 50 MB.`);
        return 0;
    }
    catch (error) {
        return failure(context.output, error);
    }
}
export async function exportPageData(context, page, into = process.cwd()) {
    const connected = await connect(context, page);
    if (typeof connected === 'number')
        return connected;
    let lines;
    try {
        lines = await connected.client.exportPageData(connected.address);
    }
    catch (error) {
        return failure(context.output, error);
    }
    const [, ...rest] = lines.split('\n').filter((line) => line.trim() !== '');
    const records = rest.map((line) => JSON.parse(line));
    const folder = join(into, `${connected.address.slug}-data`);
    await mkdir(folder, { recursive: true });
    const byList = new Map();
    for (const record of records)
        byList.set(record.list, [...(byList.get(record.list) ?? []), record]);
    for (const [list, rows] of [...byList].sort(([a], [b]) => a.localeCompare(b))) {
        await writeFile(join(folder, `${list}.json`), `${JSON.stringify(rows.map(({ list: _list, ...row }) => row), null, 2)}\n`);
        await writeFile(join(folder, `${list}.csv`), toCsv(rows));
    }
    context.output.out(records.length === 0
        ? `${connected.address.slug} has no saved records yet. Nothing was written.`
        : `Saved ${records.length} ${records.length === 1 ? 'record' : 'records'} from ${byList.size} ${byList.size === 1 ? 'list' : 'lists'} into ${folder}, as JSON and CSV.`);
    return 0;
}
/** Who read a page's data from outside the page itself, newest first. Owners and admins (decided 7 October 2026). */
export async function pageAccessLog(context, page) {
    const connected = await connect(context, page);
    if (typeof connected === 'number')
        return connected;
    try {
        const answer = (await connected.client.pageData(connected.address, { action: 'access_log' }));
        const entries = answer.entries ?? [];
        if (entries.length === 0) {
            context.output.out(`Nobody has read ${connected.address.slug}'s data from outside the page.`);
            return 0;
        }
        for (const entry of entries) {
            const when = new Date(entry.at * 1000).toISOString().slice(0, 16).replace('T', ' ');
            const what = entry.action === 'export' ? 'exported every list' : `read ${entry.list ?? 'a list'} through an agent`;
            context.output.out(`  ${when}  ${entry.actor}  ${what} (${entry.records} ${entry.records === 1 ? 'record' : 'records'})`);
        }
        return 0;
    }
    catch (error) {
        return failure(context.output, error);
    }
}
const FIXED = ['id', 'savedBy', 'savedAt', 'updatedBy', 'updatedAt'];
/**
 * One column per top-level key of the records' data, after the fields every
 * record has. Values that aren't text are written as JSON.
 */
export function toCsv(rows) {
    const keys = [...new Set(rows.flatMap((row) => (row.data !== null && typeof row.data === 'object' && !Array.isArray(row.data) ? Object.keys(row.data) : [])))].sort();
    const header = [...FIXED, ...keys];
    const lines = [header.map(cell).join(',')];
    for (const row of rows) {
        const data = (row.data ?? {});
        lines.push([...FIXED.map((key) => row[key]), ...keys.map((key) => data[key])].map(cell).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}
/**
 * One CSV cell. Saved values were written by the people invited to the page,
 * and a spreadsheet runs a cell that starts with = + - or @ as a formula, so
 * those get a leading apostrophe and are shown as text.
 */
function cell(value) {
    let text = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    if (/^[=+\-@\t\r]/.test(text))
        text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
//# sourceMappingURL=page-data.js.map