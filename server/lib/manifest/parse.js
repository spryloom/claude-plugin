import { parse as parseYaml, YAMLParseError } from 'yaml';
import { ManifestError } from './types.js';
import { validateManifest } from './validate.js';
/** The file name the agent writes and the CLI looks for. */
export const MANIFEST_FILENAME = 'spryloom.yaml';
/**
 * Parse and validate the text of a `spryloom.yaml`.
 *
 * A YAML syntax error is reported with its line and column, because the person
 * reading the message is looking at the file in an editor.
 */
export function parseManifest(source, options = {}) {
    let parsed;
    try {
        parsed = parseYaml(source, { prettyErrors: true });
    }
    catch (error) {
        if (error instanceof YAMLParseError) {
            const at = error.linePos?.[0];
            const where = at === undefined ? MANIFEST_FILENAME : `${MANIFEST_FILENAME}, line ${at.line}`;
            const detail = error.message.split('\n')[0];
            throw new ManifestError([
                {
                    path: where,
                    message: 'is not valid YAML.',
                    ...(detail !== undefined && { hint: detail }),
                },
            ]);
        }
        throw error;
    }
    if (parsed === undefined || parsed === null) {
        throw new ManifestError([
            {
                path: MANIFEST_FILENAME,
                message: 'is empty.',
                hint: 'Run `spry init` to write a manifest for this app.',
            },
        ]);
    }
    return validateManifest(parsed, options);
}
//# sourceMappingURL=parse.js.map