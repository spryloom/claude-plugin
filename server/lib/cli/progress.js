/**
 * Showing a publish or a delete while it runs (D99, findings F1 and F4).
 *
 * In a terminal, one block redrawn in place: every stage, a spinner and timer
 * on the current one, and the latest build line beside it. Anywhere else, an
 * agent capturing output or CI, one plain line each time the stage changes, so
 * the log reads top to bottom with no control characters in it.
 */
import { stageLabel } from '../protocol/index.js';
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** `m:ss`, the way a person reads a wait. */
export function clock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
export function labelOf(stage, kind = 'publish') {
    return stageLabel(kind, stage);
}
/**
 * A terminal can be redrawn when it is one, output is going to it, and colour
 * is on (a person who turned colour off asked for plain text).
 */
export function canRedraw(colour, stream = process.stdout) {
    return colour && stream.isTTY === true;
}
export function progressDisplay(options) {
    return options.redraw ? redrawingDisplay(options) : plainDisplay(options.output);
}
/**
 * One line per stage, in order.
 *
 * Stages that finished between two reads still get their line, so the log
 * always reads as the whole sequence rather than whichever stages happened to
 * be caught running.
 */
function plainDisplay(output) {
    let shown = -1;
    let shownAttempt = 1;
    let latest;
    const showUpTo = (operation, index) => {
        for (let i = shown + 1; i <= index; i += 1) {
            const stage = operation.stages[i];
            if (stage === undefined)
                continue;
            const current = stage === operation.stage && operation.status === 'running';
            const line = current && operation.lastLine !== undefined ? ` ${operation.lastLine}` : '';
            output.out(`  ${labelOf(stage, operation.kind)} (${clock(operation.elapsedSeconds)})${line}`);
        }
        shown = Math.max(shown, index);
    };
    return {
        update(operation) {
            latest = operation;
            if (operation.attempt > shownAttempt) {
                shownAttempt = operation.attempt;
                output.out(`  Spryloom restarted and picked this up again at ${labelOf(operation.stage, operation.kind).toLowerCase()}.`);
            }
            const index = operation.stages.indexOf(operation.stage);
            // Finished: every stage was passed. Failed: up to the one it failed at.
            showUpTo(operation, operation.status === 'succeeded' ? operation.stages.length - 1 : index);
        },
        stop() {
            if (latest?.status === 'succeeded')
                showUpTo(latest, latest.stages.length - 1);
        },
    };
}
function redrawingDisplay(options) {
    const write = options.write ?? ((text) => void process.stdout.write(text));
    const now = options.now ?? Date.now;
    const { paint } = options;
    let latest;
    let readAt = now();
    let drawn = 0;
    let frame = 0;
    let resumedNote;
    const draw = () => {
        if (latest === undefined)
            return;
        const op = latest;
        const sinceRead = (now() - readAt) / 1000;
        const current = op.stages.indexOf(op.stage);
        const lines = [];
        op.stages.forEach((stage, index) => {
            const label = labelOf(stage, op.kind);
            if (index < current || op.status === 'succeeded') {
                lines.push(`  ${paint.green('✓')} ${label}`);
            }
            else if (index === current && op.status === 'failed') {
                lines.push(`  ${paint.red('✗')} ${label}`);
            }
            else if (index === current) {
                const spinner = paint.cyan(SPINNER[frame % SPINNER.length] ?? '•');
                const timer = paint.dim(clock(op.stageSeconds + sinceRead).padStart(5));
                const line = op.lastLine === undefined ? '' : `   ${paint.dim(`▸ ${fit(op.lastLine, 60)}`)}`;
                lines.push(`  ${spinner} ${label.padEnd(24)}${timer}${line}`);
            }
            else {
                lines.push(`    ${paint.dim(label)}`);
            }
        });
        if (resumedNote !== undefined)
            lines.push('', `  ${paint.yellow(resumedNote)}`);
        if (options.footer !== undefined)
            lines.push('', `  ${paint.dim(options.footer)}`);
        // Up to the start of the previous block, then each line cleared and rewritten.
        const up = drawn > 0 ? `\x1b[${drawn}A` : '';
        write(`${up}${lines.map((line) => `\x1b[2K${line}`).join('\n')}\n`);
        drawn = lines.length;
    };
    const ticker = setInterval(() => {
        frame += 1;
        draw();
    }, 100);
    ticker.unref();
    return {
        update(operation) {
            // Attempt 1 is the first worker taking it up. Only a later one is a resume.
            if (latest !== undefined && operation.attempt > 1 && operation.attempt > latest.attempt) {
                resumedNote = `Spryloom restarted and picked this up again at ${labelOf(operation.stage, operation.kind).toLowerCase()}.`;
            }
            latest = operation;
            readAt = now();
            draw();
        },
        stop() {
            clearInterval(ticker);
            draw();
        },
    };
}
/** Keep one line of build output to a width that will not wrap and break the redraw. */
function fit(text, width) {
    return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}
//# sourceMappingURL=progress.js.map