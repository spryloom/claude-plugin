/**
 * The Claude Code skill shipped to the user's machine.
 *
 * Decision D11: the skill's first job is not publishing, it is making sure the
 * app is written in a way that can be published. Every failure `@spryloom/detect`
 * can report is a failure this skill should have prevented, so the two are kept
 * in step by `coveredFindingCodes` below and by the test that compares them.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Where the skill's files live inside this package. */
export const skillDirectory = () => join(dirname(fileURLToPath(import.meta.url)), '..', 'skill');
export async function readSkill() {
    return readFile(join(skillDirectory(), 'SKILL.md'), 'utf8');
}
export async function readManifestReference() {
    return readFile(join(skillDirectory(), 'references', 'manifest.md'), 'utf8');
}
/** Jobs, email and outside APIs (M1*): what an app can do on its own. */
export async function readActingReference() {
    return readFile(join(skillDirectory(), 'references', 'acting.md'), 'utf8');
}
/** Bringing a Claude artifact: it becomes a page that saves data, with its records. */
export async function readArtifactReference() {
    return readFile(join(skillDirectory(), 'references', 'artifact.md'), 'utf8');
}
/**
 * Every failure the platform can report, mapped to the phrase in the skill that
 * teaches an agent to avoid it.
 *
 * A finding with no entry here means the platform can reject an app for a reason
 * the agent was never told about, which is the gap D11 exists to close.
 */
export const PREVENTION_RULES = {
    hardcoded_port: 'process.env.PORT',
    no_lockfile: 'Commit a lockfile',
    env_file_committed: 'never commit a `.env`',
    no_start_command: 'Give the app a start script',
    nothing_to_run: 'nothing to run',
    dockerfile_missing: 'If a Dockerfile already exists, it is used as-is',
};
//# sourceMappingURL=index.js.map