/**
 * Copy a starter app into a folder, ready to publish.
 *
 * The guide used to say the beta owner could hand somebody the request tracker,
 * which meant nobody could try Spryloom's own example without asking first. The
 * starter now ships inside the package, and this puts a copy of it on disk. The
 * copy is ordinary source: the person's own agent reads it, changes it, and
 * publishes it like anything else it built.
 *
 * It refuses a folder that already has something in it. Copying a starter over
 * somebody's work would be the one thing this command could do wrong.
 */
import { cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { painter } from '../ui.js';
/** The starters this command knows. */
export const STARTERS = {
    'request-tracker': {
        description: 'A shared queue where coworkers submit, assign, comment on and complete requests.',
        slug: 'requests',
    },
};
/**
 * Where a starter's files are.
 *
 * Two layouts reach this file. In the published package it is
 * `lib/cli/commands/starter.js` and the starters are copied to `lib/starters`
 * by `dev/pack.ts`. In this repository it is `packages/cli/{src,dist}/commands`
 * and the starters are at the repository root. Both are asked for, in that
 * order, so the command behaves the same wherever it runs.
 */
export function starterDirectory(name) {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, '..', '..', 'starters', name),
        join(here, '..', '..', '..', '..', 'starters', name),
    ];
    return candidates.find((candidate) => existsSync(join(candidate, 'spryloom.yaml')));
}
/** Dependencies are installed by the build, never copied from anyone's disk. */
const SKIPPED = new Set(['node_modules', '.env']);
function shortestPath(destination) {
    const nearby = relative(process.cwd(), destination);
    return nearby === '' || nearby.startsWith('..') ? destination : nearby;
}
export async function starter(name, folder, context) {
    const paint = painter(context.colour);
    const { output } = context;
    const chosen = name === undefined ? undefined : STARTERS[name];
    if (name === undefined || chosen === undefined) {
        const stream = name === undefined ? output.out : output.err;
        if (name !== undefined) {
            stream(`There is no starter called "${name}".`);
            stream('');
        }
        stream('Starters you can copy:');
        stream('');
        for (const [known, { description }] of Object.entries(STARTERS)) {
            stream(`  ${paint.bold(known)}  ${description}`);
        }
        stream('');
        stream(paint.dim('  spry starter request-tracker [folder]'));
        return name === undefined ? 0 : 2;
    }
    const source = starterDirectory(name);
    if (source === undefined) {
        output.err(`The ${name} starter is missing from this installation of spry.`);
        output.err('');
        output.err('Reinstall it, and the starter comes with it:');
        output.err(paint.dim('  npm install -g spryloom'));
        return 1;
    }
    const destination = resolve(folder ?? name);
    if (existsSync(destination) && (await readdir(destination)).length > 0) {
        output.err(`${shortestPath(destination)} already has files in it.`);
        output.err('');
        output.err('A starter is copied into a new or empty folder, so nothing of yours is overwritten.');
        output.err(paint.dim(`  spry starter ${name} ./another-folder`));
        return 1;
    }
    await cp(source, destination, {
        recursive: true,
        filter: (path) => !SKIPPED.has(basename(path)),
    });
    const where = shortestPath(destination);
    output.out('');
    output.out(`${paint.green('Copied')} the ${paint.bold(name)} starter to ${paint.bold(where)}`);
    output.out('');
    output.out(`  ${chosen.description}`);
    output.out('');
    output.out('Publish it, then invite a coworker to try it with you:');
    output.out('');
    output.out(paint.dim(`  cd ${where}`));
    output.out(paint.dim('  spry publish'));
    output.out(paint.dim(`  spry invite ${chosen.slug} --email coworker@yourcompany.com`));
    output.out('');
    output.out('Or open the folder in your coding agent and ask it to make the tracker yours.');
    output.out('');
    return 0;
}
//# sourceMappingURL=starter.js.map