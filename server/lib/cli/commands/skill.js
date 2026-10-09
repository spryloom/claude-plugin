/**
 * Put the agent skill on the user's machine.
 *
 * Decision D11: when an agent-built app fails to publish, the fix belongs in
 * the skill so the app is written correctly, not in a smarter analyzer at
 * deploy time. A skill that only exists in this repository fixes nothing, so
 * this is how it reaches a project — the same file the platform tests against,
 * copied in, not a summary of it.
 *
 * It refuses to overwrite. Somebody may have edited theirs, and silently
 * replacing an edited file is the kind of thing a tool only has to do once.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readActingReference, readArtifactReference, readSkill, readManifestReference } from '../../agent-skill/index.js';
import { painter } from '../ui.js';
/**
 * Where Claude Code looks for a project's skills.
 *
 * One agent product is named because one has this shape. Codex and Cursor get
 * the same guidance through the tool descriptions the MCP server carries, which
 * needs nothing written to disk.
 */
export const SKILL_DIRECTORY = join('.claude', 'skills', 'spryloom');
/**
 * The shorter of the two ways to name a path, so a folder inside this one reads
 * as `.claude/skills/spryloom` rather than a row of parent directories.
 */
function shortestPath(destination) {
    const nearby = relative(process.cwd(), destination);
    return nearby === '' || nearby.startsWith('..') ? destination : nearby;
}
export async function skill(root, options, context) {
    const paint = painter(context.colour);
    const { output } = context;
    const files = [
        [join(SKILL_DIRECTORY, 'SKILL.md'), await readSkill()],
        [join(SKILL_DIRECTORY, 'references', 'manifest.md'), await readManifestReference()],
        [join(SKILL_DIRECTORY, 'references', 'acting.md'), await readActingReference()],
        [join(SKILL_DIRECTORY, 'references', 'artifact.md'), await readArtifactReference()],
    ];
    const already = [];
    for (const [path] of files) {
        try {
            await readFile(resolve(root, path), 'utf8');
            already.push(path);
        }
        catch {
            // Not there, which is the ordinary case.
        }
    }
    if (already.length > 0 && options.force !== true) {
        output.err(`${already[0]} is already here.`);
        output.err('');
        output.err('Yours may have been edited, so this will not overwrite it.');
        output.err(paint.dim('  spry skill --force'));
        return 1;
    }
    for (const [path, contents] of files) {
        const destination = resolve(root, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, contents, 'utf8');
    }
    output.out('');
    output.out(`Skill written to ${paint.bold(shortestPath(resolve(root, SKILL_DIRECTORY)))}`);
    output.out('');
    output.out('Your coding agent will now write apps that publish, and publish them');
    output.out('itself. It reaches Spryloom through the agent tools:');
    output.out('');
    output.out(paint.dim('  claude mcp add spryloom -- spry mcp'));
    output.out('');
    return 0;
}
//# sourceMappingURL=skill.js.map