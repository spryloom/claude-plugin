/**
 * Five-field cron schedules, in a time zone (M1*, D81).
 *
 * Written here rather than pulled in, because the same rules have to hold in
 * three places that must agree: the CLI checking a manifest, the control plane
 * refusing one, and the scheduler deciding when a job runs. A library that
 * parsed `0 9 * * 1-5` one way in the terminal and another in the scheduler
 * would be a job that runs at a time nobody was told.
 *
 * The format is the one every coding agent already writes:
 *
 *   minute  hour  day-of-month  month  day-of-week
 *
 * with `*`, lists (`1,15`), ranges (`1-5`), steps (`*\/15`, `9-17/2`), month
 * names (`JAN`) and day names (`MON`). Day-of-week 0 and 7 are both Sunday.
 * When both day fields are restricted, a day matches if either does, which is
 * what cron has always done and what people who write cron expect.
 *
 * Daylight saving, decided once so it cannot drift:
 *
 *  - A local time that does not exist, because the clocks jumped over it, runs
 *    at the first moment after the jump. `30 2 * * *` in New York runs at 3:30
 *    on the morning the clocks go forward, rather than not at all.
 *  - A local time that happens twice, because the clocks went back, runs once,
 *    at the first of the two.
 */
/** Why a schedule was refused, in words a person can act on. */
export class CronError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CronError';
    }
}
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const FIELDS = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day of the month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
    { name: 'day of the week', min: 0, max: 7, names: DAY_NAMES, nameBase: 0 },
];
function value(text, rule) {
    const upper = text.toUpperCase();
    if (rule.names !== undefined) {
        const at = rule.names.indexOf(upper);
        if (at >= 0)
            return at + (rule.nameBase ?? 0);
    }
    if (!/^\d{1,2}$/.test(text)) {
        throw new CronError(`"${text}" is not a ${rule.name}.`);
    }
    const number = Number(text);
    if (number < rule.min || number > rule.max) {
        throw new CronError(`${number} is not a ${rule.name}. It must be ${rule.min} to ${rule.max}.`);
    }
    return number;
}
function field(text, rule) {
    const out = new Set();
    for (const part of text.split(',')) {
        if (part === '')
            throw new CronError(`The ${rule.name} field has an empty entry.`);
        const [range, stepText, extra] = part.split('/');
        if (extra !== undefined || range === undefined || range === '') {
            throw new CronError(`"${part}" is not a ${rule.name}.`);
        }
        let step = 1;
        if (stepText !== undefined) {
            if (!/^\d{1,2}$/.test(stepText) || Number(stepText) === 0) {
                throw new CronError(`"/${stepText}" is not a step. Use a whole number above 0, as in */15.`);
            }
            step = Number(stepText);
        }
        let low;
        let high;
        if (range === '*') {
            low = rule.min;
            high = rule.max;
        }
        else if (range.includes('-')) {
            const [from, to, more] = range.split('-');
            if (more !== undefined || from === undefined || to === undefined) {
                throw new CronError(`"${range}" is not a range of ${rule.name}s.`);
            }
            low = value(from, rule);
            high = value(to, rule);
            if (low > high)
                throw new CronError(`"${range}" runs backwards. Write the lower ${rule.name} first.`);
        }
        else {
            low = value(range, rule);
            high = stepText === undefined ? low : rule.max;
        }
        for (let at = low; at <= high; at += step)
            out.add(at);
    }
    return [...out].sort((a, b) => a - b);
}
/** Parse a five-field expression. Throws `CronError` with the reason. */
export function parseCron(source) {
    const parts = source.trim().split(/\s+/);
    if (parts.length !== 5 || parts.some((part) => part === '')) {
        throw new CronError(`"${source}" has ${parts.filter((p) => p !== '').length} parts. A schedule has five: minute, hour, day of the month, month, day of the week.`);
    }
    const [minute, hour, day, month, weekday] = parts;
    const weekdays = field(weekday, FIELDS[4]).map((d) => (d === 7 ? 0 : d));
    return {
        source: parts.join(' '),
        minutes: field(minute, FIELDS[0]),
        hours: field(hour, FIELDS[1]),
        days: field(day, FIELDS[2]),
        months: field(month, FIELDS[3]),
        weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
        anyDay: day === '*',
        anyWeekday: weekday === '*',
    };
}
// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------
const formatters = new Map();
function formatter(timeZone) {
    let found = formatters.get(timeZone);
    if (found === undefined) {
        found = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
        formatters.set(timeZone, found);
    }
    return found;
}
/** Whether a name is an IANA time zone this runtime knows, such as `Europe/London`. */
export function isTimeZone(name) {
    if (name === '' || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(name))
        return false;
    try {
        formatter(name);
        return true;
    }
    catch {
        return false;
    }
}
function wallAt(ms, timeZone) {
    const parts = {};
    for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
        if (part.type !== 'literal')
            parts[part.type] = Number(part.value);
    }
    return {
        year: parts['year'] ?? 1970,
        month: parts['month'] ?? 1,
        day: parts['day'] ?? 1,
        hour: parts['hour'] ?? 0,
        minute: parts['minute'] ?? 0,
        second: parts['second'] ?? 0,
    };
}
/** How far ahead of UTC the zone's clocks are at this instant, in milliseconds. */
function offsetAt(ms, timeZone) {
    const wall = wallAt(ms, timeZone);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
}
const HOUR = 3_600_000;
/**
 * The instant a wall-clock time in a zone happens.
 *
 * The rules at the top of this file: a skipped time moves forward past the
 * gap, and a repeated time takes the first of the two.
 */
function instantOf(wall, timeZone) {
    const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    const before = offsetAt(guess - 12 * HOUR, timeZone);
    const after = offsetAt(guess + 12 * HOUR, timeZone);
    const candidates = [...new Set([guess - before, guess - after])].sort((a, b) => a - b);
    for (const candidate of candidates) {
        const seen = wallAt(candidate, timeZone);
        if (seen.year === wall.year &&
            seen.month === wall.month &&
            seen.day === wall.day &&
            seen.hour === wall.hour &&
            seen.minute === wall.minute) {
            return candidate;
        }
    }
    // In a gap: the offset from before the jump lands just after it.
    return guess - before;
}
function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function dayMatches(schedule, year, month, day) {
    if (!schedule.months.includes(month))
        return false;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const byDay = schedule.days.includes(day);
    const byWeekday = schedule.weekdays.includes(weekday);
    if (schedule.anyDay && schedule.anyWeekday)
        return true;
    if (schedule.anyDay)
        return byWeekday;
    if (schedule.anyWeekday)
        return byDay;
    return byDay || byWeekday;
}
/** How far ahead the scheduler looks for a run before calling a schedule dead. */
const SEARCH_DAYS = 366 * 5;
/**
 * The first run strictly after `after`, in milliseconds since the epoch.
 *
 * Undefined when the schedule has no run in the next five years, such as
 * `0 0 30 2 *`, which asks for 30 February.
 */
export function nextRun(schedule, timeZone, after) {
    const start = wallAt(after, timeZone);
    let year = start.year;
    let month = start.month;
    let day = start.day;
    for (let scanned = 0; scanned < SEARCH_DAYS; scanned += 1) {
        if (dayMatches(schedule, year, month, day)) {
            for (const hour of schedule.hours) {
                for (const minute of schedule.minutes) {
                    const at = instantOf({ year, month, day, hour, minute }, timeZone);
                    if (at > after)
                        return at;
                }
            }
        }
        day += 1;
        if (day > daysInMonth(year, month)) {
            day = 1;
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        }
    }
    return undefined;
}
/**
 * The shortest gap between two consecutive runs, over the next `count` runs.
 *
 * Returns the two runs either side of it, so a refusal can say what it saw.
 * Stops early at the first gap below `stopBelow`, because a schedule every
 * minute would otherwise be expanded five hundred times to be told no.
 */
export function shortestGap(schedule, timeZone, from, count, stopBelow) {
    let previous = nextRun(schedule, timeZone, from);
    if (previous === undefined)
        return undefined;
    let best;
    for (let seen = 1; seen < count; seen += 1) {
        const next = nextRun(schedule, timeZone, previous);
        if (next === undefined)
            break;
        const gap = next - previous;
        if (best === undefined || gap < best.gap)
            best = { gap, first: previous, second: next };
        if (gap < stopBelow)
            break;
        previous = next;
    }
    return best;
}
// ---------------------------------------------------------------------------
// Saying it in words, for the label page and the publish output
// ---------------------------------------------------------------------------
function clock(hour, minute) {
    const suffix = hour < 12 ? 'AM' : 'PM';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}
function list(items) {
    if (items.length <= 1)
        return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}
const DAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * A schedule in words, when it has a common shape: "weekdays at 9:00 AM".
 *
 * Anything it cannot say plainly is quoted as written, which is honest and
 * still readable to the person who wrote it.
 */
export function describeSchedule(schedule) {
    const allMonths = schedule.months.length === 12;
    const fewTimes = schedule.hours.length * schedule.minutes.length <= 4;
    if (!allMonths || !fewTimes)
        return `on the schedule "${schedule.source}"`;
    const times = [];
    for (const hour of schedule.hours)
        for (const minute of schedule.minutes)
            times.push(clock(hour, minute));
    const at = `at ${list(times)}`;
    if (schedule.anyDay && schedule.anyWeekday)
        return `every day ${at}`;
    if (schedule.anyDay) {
        const days = schedule.weekdays;
        if (days.join(',') === '1,2,3,4,5')
            return `weekdays ${at}`;
        if (days.join(',') === '0,6')
            return `weekends ${at}`;
        return `${list(days.map((d) => `${DAY_WORDS[d] ?? ''}s`))} ${at}`;
    }
    if (schedule.anyWeekday && schedule.days.length <= 3) {
        return `on day ${list(schedule.days.map(String))} of every month ${at}`;
    }
    return `on the schedule "${schedule.source}"`;
}
//# sourceMappingURL=cron.js.map