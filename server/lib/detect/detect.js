import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
/** Files scanned for a hardcoded port. Kept small: this is a hint, not a compiler. */
const ENTRY_CANDIDATES = [
    'server.js', 'server.ts', 'server.mjs',
    'index.js', 'index.ts', 'index.mjs',
    'app.js', 'app.ts',
    'main.js', 'main.ts',
    'src/server.js', 'src/server.ts',
    'src/index.js', 'src/index.ts',
    'src/app.js', 'src/app.ts',
    'src/main.js', 'src/main.ts',
];
const LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
];
const POSTGRES_PACKAGES = ['pg', 'postgres', 'drizzle-orm', 'knex', 'kysely', 'prisma', '@prisma/client', 'sequelize', 'typeorm'];
const FRONTEND_BUILDERS = ['vite', 'webpack', 'parcel', 'esbuild', 'rollup', 'react-scripts'];
/** Default output directories, in the order they are checked. */
const STATIC_DIR_CANDIDATES = ['dist', 'build', 'public', 'out'];
async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch {
        return undefined;
    }
}
/**
 * Find a port literal passed to `listen` where `PORT` is not read anywhere in the
 * file.
 *
 * This is the single most common reason an agent-built app builds and then fails
 * to serve traffic, so it is worth catching before a deploy rather than after.
 * Deliberately conservative: a file that mentions `process.env.PORT` at all is
 * left alone, because the shapes people write are too varied to parse reliably.
 */
export function findHardcodedPort(source) {
    if (/process\.env\.PORT|process\.env\[['"]PORT['"]\]|Deno\.env\.get\(['"]PORT['"]\)/.test(source)) {
        return undefined;
    }
    const lines = source.split('\n');
    for (const [index, line] of lines.entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line))
            continue;
        if (/\.listen\s*\(\s*['"`]?\d{2,5}\b/.test(line))
            return index + 1;
    }
    return undefined;
}
function dependencyNames(pkg) {
    return new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
    ]);
}
function parseNodeMajor(engines) {
    const spec = engines?.['node'];
    if (spec === undefined)
        return undefined;
    const match = /(\d+)/.exec(spec);
    if (match?.[1] === undefined)
        return undefined;
    const major = Number.parseInt(match[1], 10);
    return Number.isFinite(major) ? major : undefined;
}
/**
 * Read a directory and work out how to run what is in it.
 *
 * The manifest remains the contract (D3). This exists for apps imported without
 * one, and to give the CLI something to propose when it writes a manifest.
 */
export async function detect(root) {
    const findings = [];
    const pkg = await readJson(join(root, 'package.json'));
    const hasIndexHtml = (await exists(join(root, 'index.html'))) || (await exists(join(root, 'public/index.html')));
    // A user-supplied Dockerfile wins outright (D10).
    const dockerfile = (await exists(join(root, 'Dockerfile'))) ? 'Dockerfile' : undefined;
    if (pkg === undefined && !hasIndexHtml) {
        findings.push({
            severity: 'blocker',
            code: 'nothing_to_run',
            message: 'This folder has no package.json and no index.html, so Spryloom cannot tell what to run.',
            hint: 'Publish from the folder that contains your app, or add a Dockerfile.',
        });
        return { frontend: 'none', backend: 'none', usesPostgres: false, findings };
    }
    // ---- static-only ------------------------------------------------------
    if (pkg === undefined) {
        return {
            frontend: 'static',
            backend: 'none',
            ...(dockerfile !== undefined && { dockerfile }),
            staticDir: '.',
            usesPostgres: false,
            findings,
        };
    }
    const deps = dependencyNames(pkg);
    const scripts = pkg.scripts ?? {};
    const hasReact = deps.has('react');
    const hasFrontendBuilder = FRONTEND_BUILDERS.some((tool) => deps.has(tool));
    const frontend = hasReact
        ? 'react'
        : hasIndexHtml || hasFrontendBuilder
            ? 'static'
            : 'none';
    const build = scripts['build'];
    const startScript = scripts['start'];
    const start = startScript !== undefined
        ? 'npm start'
        : pkg.main !== undefined
            ? `node ${pkg.main}`
            : undefined;
    // A backend exists when something can serve requests: a start script, an entry
    // point, or a server framework in the dependency list.
    const serverFrameworks = ['express', 'hono', 'fastify', 'koa', 'next', '@hono/node-server'];
    const hasServer = startScript !== undefined ||
        pkg.main !== undefined ||
        serverFrameworks.some((framework) => deps.has(framework));
    const backend = hasServer ? 'node' : 'none';
    if (backend === 'node' && start === undefined && dockerfile === undefined) {
        findings.push({
            severity: 'blocker',
            code: 'no_start_command',
            message: 'This app has a server but no way to start it.',
            hint: 'Add a "start" script to package.json, for example: "start": "node server.js"',
            file: 'package.json',
        });
    }
    // ---- lockfile ---------------------------------------------------------
    let packageManager;
    for (const [file, manager] of LOCKFILES) {
        if (await exists(join(root, file))) {
            packageManager = manager;
            break;
        }
    }
    if (packageManager === undefined) {
        findings.push({
            severity: 'warning',
            code: 'no_lockfile',
            message: 'There is no lockfile, so the versions installed today may differ from tomorrow.',
            hint: 'Run `npm install` and commit package-lock.json before publishing.',
        });
    }
    // ---- things that should not reach the build ---------------------------
    if (await exists(join(root, '.env'))) {
        findings.push({
            severity: 'warning',
            code: 'env_file_committed',
            // What it used to say was that the file "would be copied into the image".
            // It would not: anything starting `.env` is left behind when the folder is
            // packed. Saying otherwise told people their secrets had leaked when they
            // had not, and a warning that is wrong in that direction is worse than
            // none, because the next one is not believed either.
            message: 'A .env file is here. It is not published, so the app will not have these values.',
            hint: 'Set them with `spry secrets set`, so the running app has them. Add .env to .gitignore as well.',
            file: '.env',
        });
    }
    // ---- hardcoded port ---------------------------------------------------
    if (backend === 'node') {
        for (const candidate of ENTRY_CANDIDATES) {
            const path = join(root, candidate);
            if (!(await exists(path)))
                continue;
            const line = findHardcodedPort(await readFile(path, 'utf8'));
            if (line !== undefined) {
                findings.push({
                    severity: 'warning',
                    code: 'hardcoded_port',
                    message: 'This app listens on a fixed port and ignores the one Spryloom assigns.',
                    hint: 'Use: server.listen(process.env.PORT || 3000)',
                    file: relative(root, path) || candidate,
                    line,
                });
                break;
            }
        }
    }
    // ---- static output directory ------------------------------------------
    let staticDir;
    if (frontend !== 'none') {
        for (const candidate of STATIC_DIR_CANDIDATES) {
            if (await exists(join(root, candidate))) {
                staticDir = candidate;
                break;
            }
        }
        staticDir ??= build !== undefined ? 'dist' : '.';
    }
    const nodeMajor = parseNodeMajor(pkg.engines);
    return {
        frontend,
        backend,
        ...(dockerfile !== undefined && { dockerfile }),
        ...(build !== undefined && { build: 'npm run build' }),
        ...(start !== undefined && { start }),
        ...(packageManager !== undefined && { packageManager }),
        ...(nodeMajor !== undefined && { nodeMajor }),
        ...(staticDir !== undefined && { staticDir }),
        usesPostgres: POSTGRES_PACKAGES.some((name) => deps.has(name)),
        findings,
    };
}
/** List the entries of a directory, used by the CLI to show what will be uploaded. */
export async function listSourceFiles(root) {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map((entry) => entry.name)
        .sort();
}
//# sourceMappingURL=detect.js.map