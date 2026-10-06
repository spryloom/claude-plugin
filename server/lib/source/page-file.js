/**
 * One file published as a page (D105): `spry publish report.html` or
 * `spry publish notes.md`.
 *
 * A page is a folder with an `index.html` in it, and everything downstream
 * already knows what to do with one. So a single file becomes exactly that,
 * in a temporary folder: the HTML as `index.html`, or the Markdown rendered
 * into a plain readable page beside its source as `index.md`. Nothing is
 * written next to the person's own file.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { marked } from 'marked';
/** A path that names a page file but isn't one: missing, or unreadable. */
export class PageFileError extends Error {
    hint;
    constructor(message, hint) {
        super(message);
        this.hint = hint;
        this.name = 'PageFileError';
    }
}
/** A file that publishes as a page on its own. */
export const PAGE_FILE = /\.(html?|md|markdown)$/i;
const escape = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
/**
 * Markdown as a page someone would want to read: one column, system fonts,
 * tables and code that don't overflow. No scripts, nothing loaded from
 * anywhere else.
 */
export function renderMarkdownPage(markdown, fallbackTitle) {
    const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
    const title = heading ?? fallbackTitle;
    const body = marked.parse(markdown, { async: false, gfm: true });
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1d1d1f; --muted: #5f6368; --line: #e3e3e8; --code: #f5f5f7; --link: #2456c9; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ececf1; --muted: #a0a0ab; --line: #2e2e36; --code: #1c1c22; --link: #8ab4ff; } }
  body { margin: 0; background: Canvas; color: var(--ink); font: 17px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 48px 20px 96px; }
  h1, h2, h3 { line-height: 1.25; margin: 1.8em 0 0.6em; }
  h1 { font-size: 2rem; margin-top: 0; }
  a { color: var(--link); }
  img { max-width: 100%; height: auto; }
  pre { background: var(--code); padding: 14px 16px; border-radius: 10px; overflow-x: auto; font-size: 14px; }
  code { font: 0.92em ui-monospace, SFMono-Regular, Menlo, monospace; }
  :not(pre) > code { background: var(--code); padding: 2px 5px; border-radius: 5px; }
  table { border-collapse: collapse; display: block; overflow-x: auto; margin: 1.2em 0; }
  th, td { border: 1px solid var(--line); padding: 7px 12px; text-align: left; }
  blockquote { margin: 1.2em 0; padding: 0 16px; border-left: 3px solid var(--line); color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2.4em 0; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
/**
 * Files a page links to on this machine, which a single file can't bring.
 *
 * Anything with a scheme, a protocol-relative URL, a fragment or data is
 * somebody else's or inline; everything else is a file next to this one, and
 * publishing one file leaves it behind.
 */
export function localReferences(html) {
    const found = new Set();
    for (const match of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
        const value = (match[1] ?? '').trim();
        if (value === '' || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value))
            continue;
        found.add(value.split(/[?#]/)[0] ?? value);
    }
    return [...found];
}
/** The page's own name for itself: its `<title>`, else its first `<h1>`, as plain text. */
export function titleOf(html) {
    const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
    if (raw === undefined)
        return undefined;
    const text = raw
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    return text === '' ? undefined : text.slice(0, 200);
}
/** Make a page folder from one `.html` or `.md` file. */
export async function pageFolderFromFile(path) {
    const name = basename(path);
    const suggestedName = name.replace(PAGE_FILE, '');
    let contents;
    try {
        contents = await readFile(path, 'utf8');
    }
    catch {
        throw new PageFileError(`There is no file at ${path}.`, 'Check the path, or publish the folder the page is in.');
    }
    const root = await mkdtemp(join(tmpdir(), 'spryloom-page-'));
    try {
        let html;
        if (/\.(md|markdown)$/i.test(name)) {
            html = renderMarkdownPage(contents, suggestedName);
            await writeFile(join(root, 'index.md'), contents, 'utf8');
        }
        else {
            html = contents;
        }
        await writeFile(join(root, 'index.html'), html, 'utf8');
        const missing = localReferences(html);
        const notes = missing.length === 0
            ? []
            : [
                `${name} links to ${missing.length === 1 ? 'a file' : 'files'} on this machine that a single file can't bring: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', and more' : ''}.`,
                'Publish the folder instead, so they come with it.',
            ];
        const title = titleOf(html);
        return {
            root,
            suggestedName,
            notes,
            ...(title !== undefined && { title }),
            dispose: () => rm(root, { recursive: true, force: true }),
        };
    }
    catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
}
//# sourceMappingURL=page-file.js.map