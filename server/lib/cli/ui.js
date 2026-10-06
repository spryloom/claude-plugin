/**
 * Terminal output.
 *
 * The wording here is part of the product. Acceptance specification §5 fixes the
 * text of known failures, so this module keeps formatting separate from the
 * sentences, and never invents an apology or a vague message.
 */
const ESCAPES = {
    reset: '[0m',
    bold: '[1m',
    dim: '[2m',
    red: '[31m',
    green: '[32m',
    yellow: '[33m',
    cyan: '[36m',
};
/**
 * Colour is off when a machine is reading, when the user asked for it to be off,
 * or when the terminal cannot show it. An agent capturing this output gets plain
 * text without having to strip anything.
 */
export function colourEnabled(env = process.env, isTty = process.stdout.isTTY) {
    if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '')
        return false;
    if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0')
        return true;
    if (env['TERM'] === 'dumb')
        return false;
    return isTty === true;
}
export function painter(enabled) {
    const wrap = (code) => (text) => enabled ? `${code}${text}${ESCAPES.reset}` : text;
    return {
        bold: wrap(ESCAPES.bold),
        dim: wrap(ESCAPES.dim),
        red: wrap(ESCAPES.red),
        green: wrap(ESCAPES.green),
        yellow: wrap(ESCAPES.yellow),
        cyan: wrap(ESCAPES.cyan),
    };
}
export const consoleOutput = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
};
/** Collects output in memory, for tests. */
export function bufferedOutput() {
    const lines = [];
    const errors = [];
    return {
        lines,
        errors,
        out: (line) => void lines.push(line),
        err: (line) => void errors.push(line),
    };
}
/** Render `label   value` pairs with the values aligned. */
export function describeRows(rows, paint) {
    const width = rows.reduce((widest, [label]) => Math.max(widest, label.length), 0);
    return rows.map(([label, value]) => `  ${paint.dim(label.padEnd(width))}  ${value}`);
}
/** Wrap text to a width, indenting every line. Keeps messages readable in a narrow terminal. */
export function wrap(text, indent, width = 76) {
    const limit = Math.max(20, width - indent.length);
    const lines = [];
    let current = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        if (current === '') {
            current = word;
        }
        else if (current.length + 1 + word.length <= limit) {
            current = `${current} ${word}`;
        }
        else {
            lines.push(indent + current);
            current = word;
        }
    }
    if (current !== '')
        lines.push(indent + current);
    return lines;
}
//# sourceMappingURL=ui.js.map