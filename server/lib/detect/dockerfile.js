/**
 * Node major version used when the app does not ask for one.
 *
 * Customer apps are held to the same runtime policy as the platform (D18): a
 * version that still receives security patches. An app asking for something
 * older is moved up rather than run unpatched.
 */
const DEFAULT_NODE_MAJOR = 24;
const SUPPORTED_NODE_MAJORS = [22, 24];
/** The static file server injected into image builds for frontend-only apps. */
const STATIC_SERVER_PATH = '.spryloom/serve.js';
function chooseNodeMajor(requested) {
    if (requested === undefined)
        return DEFAULT_NODE_MAJOR;
    return SUPPORTED_NODE_MAJORS.includes(requested) ? requested : DEFAULT_NODE_MAJOR;
}
function installCommand(manager) {
    const install = (() => {
        switch (manager) {
            case 'pnpm':
                return 'corepack enable && pnpm install --frozen-lockfile';
            case 'yarn':
                return 'corepack enable && yarn install --immutable';
            case 'npm':
                return 'npm ci';
            default:
                // No lockfile: `detect` already warned. Install anyway so the publish works.
                return 'npm install --no-audit --no-fund';
        }
    })();
    // An app with no dependencies installs nothing and leaves no node_modules
    // behind, which would then fail the copy into the next stage. Small apps built
    // against Node's own libraries hit this, so the directory is always created.
    return `${install} && mkdir -p /app/node_modules`;
}
function lockfileFor(manager) {
    switch (manager) {
        case 'pnpm':
            return 'pnpm-lock.yaml';
        case 'yarn':
            return 'yarn.lock';
        case 'npm':
            return 'package-lock.json';
        default:
            return '';
    }
}
/**
 * A static file server, injected only for apps that have no backend of their own.
 *
 * It exists so a frontend-only app runs under the same isolated runtime as every
 * other app rather than needing a second serving path. It reads the port from the
 * environment, refuses to serve outside its root, and adds no dependencies.
 */
const STATIC_SERVER = `// Written by Spryloom. Serves this app's built files.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.env.SPRYLOOM_STATIC_ROOT ?? '/app/public');
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = resolve(join(ROOT, normalize(decoded)));
  // Never serve outside the root, whatever the path contained.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      await stat(index);
      return index;
    }
    return candidate;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let file = await resolveFile(request.url ?? '/');
  // Single-page applications: unknown paths fall back to the entry document.
  if (file === null) file = await resolveFile('/index.html');
  if (file === null) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}).listen(PORT, '0.0.0.0');
`;
const DOCKERIGNORE = `# Written by Spryloom.
node_modules
.git
.env
.env.*
*.log
dist
build
out
.DS_Store
`;
/**
 * Produce a Dockerfile for an app that does not supply one (D10).
 *
 * The image is built in stages so that compilers and dev dependencies never
 * reach the runtime layer, and it runs as a non-root user on a read-only root
 * filesystem, which is what the runtime expects (D16).
 */
export function generateDockerfile(detection) {
    const nodeMajor = chooseNodeMajor(detection.nodeMajor);
    const base = `node:${nodeMajor}-alpine`;
    const install = installCommand(detection.packageManager);
    const lockfile = lockfileFor(detection.packageManager);
    const isStaticOnly = detection.backend === 'none';
    const lines = [
        '# Written by Spryloom because this app has no Dockerfile of its own.',
        '# Edit it and commit it, and Spryloom will use yours instead.',
        '#',
        '# Base images are pinned by digest in CI; the tag is shown here for readability.',
        '',
        '# --- dependencies -------------------------------------------------------',
        `FROM ${base} AS deps`,
        'WORKDIR /app',
        lockfile === ''
            ? 'COPY package.json ./'
            : `COPY package.json ${lockfile} ./`,
        `RUN ${install}`,
        '',
        '# --- build --------------------------------------------------------------',
        `FROM ${base} AS build`,
        'WORKDIR /app',
        'COPY --from=deps /app/node_modules ./node_modules',
        'COPY . .',
    ];
    if (detection.build !== undefined) {
        lines.push(`RUN ${detection.build}`);
    }
    lines.push('', '# --- runtime ------------------------------------------------------------', `FROM ${base} AS runtime`);
    lines.push('ENV NODE_ENV=production', '# The runtime assigns the port. Read it; do not hardcode one.', 'ENV PORT=8080', 'WORKDIR /app', '', '# Runs unprivileged. The image ships with the node user already created.', 'USER node');
    if (isStaticOnly) {
        const source = detection.staticDir ?? 'dist';
        lines.push('', `COPY --from=build --chown=node:node /app/${source} ./public`, `COPY --chown=node:node ${STATIC_SERVER_PATH} ./serve.js`, 'ENV SPRYLOOM_STATIC_ROOT=/app/public', 'EXPOSE 8080', `CMD ${JSON.stringify(splitCommand('node serve.js'))}`);
    }
    else {
        lines.push('', '# Production dependencies only: build tooling never reaches the runtime image.', 'COPY --from=build --chown=node:node /app/node_modules ./node_modules', 'COPY --from=build --chown=node:node /app ./', 'EXPOSE 8080', `CMD ${JSON.stringify(splitCommand(detection.start ?? 'npm start'))}`);
    }
    return {
        dockerfile: `${lines.join('\n')}\n`,
        extraFiles: isStaticOnly ? { [STATIC_SERVER_PATH]: STATIC_SERVER } : {},
        dockerignore: DOCKERIGNORE,
        nodeMajor,
    };
}
/**
 * Split a start command into exec-form arguments.
 *
 * Exec form matters: it makes the process PID 1's direct child, so a shutdown
 * signal reaches the app instead of a shell that ignores it.
 */
export function splitCommand(command) {
    const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    return parts.map((part) => (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))
        ? part.slice(1, -1)
        : part);
}
//# sourceMappingURL=dockerfile.js.map