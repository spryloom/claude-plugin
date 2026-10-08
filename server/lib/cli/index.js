#!/usr/bin/env node
/**
 * The `spry` command.
 *
 * Decision D3: publishing is an agent tool call first and a command second, so
 * this is deliberately small. Its output is read by people and captured by
 * coding agents, which is why colour switches itself off when nothing is
 * attached to a terminal.
 */
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { colourEnabled, consoleOutput } from './ui.js';
import { check } from './commands/check.js';
import { init } from './commands/init.js';
import { skill } from './commands/skill.js';
import { starter } from './commands/starter.js';
import * as platform from './commands/platform.js';
import { exportPageData, pageAccessLog, showPageData } from './commands/page-data.js';
const VERSION = '0.1.13';
/**
 * A GitHub token, for publishing from a private repository.
 *
 * From the environment rather than a flag, because a flag is in the process
 * list where every other process on the machine can read it. It is sent to
 * GitHub to download the code and reaches Spryloom at no point (D35).
 */
function githubToken(env) {
    const token = env['GITHUB_TOKEN'] ?? env['GH_TOKEN'];
    return token === undefined || token === '' ? undefined : token;
}
const VISIBILITIES = ['private', 'invited', 'company', 'link'];
const HELP = `spry ${VERSION}

  Publish small software to Spryloom.

Usage
  spry login --email you@company.com   Sign in. Spryloom emails you a link.
  spry publish [folder]                Publish this app for your team
  spry publish ./app.zip               Publish from a zip of the folder
  spry publish github.com/you/app      Publish from a GitHub repository
  spry publish report.html             Publish one page: no server, opens instantly
  spry publish notes.md                Publish Markdown as a readable page
  spry publish report.html --visibility invited   A page people you invite can open
  spry apps                            Every app in your workspace
  spry invite <app> --email ...        Let someone use an app
  spry uninvite <app> --email ...      Remove someone's app access
  spry logs <app>                      Recent output from a running app
  spry logs <app> --job <job>          A scheduled job's recent runs and output
  spry jobs <app>                      An app's scheduled jobs, and when they run
  spry jobs run <app> <job>            Run a job now
  spry jobs resume <app> <job>         Resume a job that was paused after failing
  spry secrets <app> set NAME=value    Give an app a value nobody can read back
  spry rollback <app> [--to N]         Return an app to an earlier version
  spry restart <app>                   Start an app that has stopped
  spry archive <app>                   Stop serving an app while keeping its data
  spry restore <app>                   Restore an archived app and its retained data
  spry export <app>                    Print a portable app metadata export as JSON
  spry data <page>                     A page's saved lists and how much they hold
  spry data export <page>              Save every record of a page, as JSON and CSV
  spry data log <page>                 Who read a page's data from outside it
  spry delete <app> <app>              Remove an app, its database and its data

  spry starter                                      Starter apps you can copy and publish
  spry starter request-tracker [folder]             Copy the request tracker, ready to publish
  spry init [folder] --description "what it does"   Write a spryloom.yaml for this app
  spry check [folder]                               Show what Spryloom sees, and whether it can publish
  spry whoami                                       Who this terminal is signed in as
  spry logout                                       Sign out of this machine; the token stops working
  spry logout --all                                 Sign out of every machine, for a lost laptop

Publishing from a coding agent
  spry skill [folder]                  Teach the agent in this project to write apps that publish
  spry mcp                             Serve the agent tools on stdin and stdout

  Point Claude Code at it once, and it publishes for you:
    claude mcp add spryloom -- spry mcp

Options for publish, when there is no spryloom.yaml
  --description <text>   One sentence your coworkers will read. A page's title is used if absent.
  --visibility <who>     private | invited | company | link. Defaults to private.
  --domain <domain>      Email domain, required when visibility is company.

Options for init
  --description <text>   One sentence your coworkers will read. Required.
  --name <text>          App name. Defaults to package.json name, then the folder name.
  --visibility <who>     private | invited | company | link. Defaults to private.
  --domain <domain>      Email domain, required when visibility is company.
  --admin <email>        Grant admin. Repeatable.
  --table <name>         A table the app stores. Repeatable. Shown on the label page.
  --no-database          This app stores nothing, whatever its dependencies suggest.
  --force                Overwrite an existing spryloom.yaml.

Secrets
  spry secrets <app> list              What is set, and when. Never the values.
  spry secrets <app> set NAME=value    Repeatable. Publish again to apply.
  spry secrets <app> remove NAME       Repeatable.

Publishing from somewhere else
  spry publish github.com/you/app@branch   A branch, tag or commit. Also #branch.
  GITHUB_TOKEN                             Set it to publish from a private repository.
                                           It reaches GitHub and nowhere else.

Other
  --email <address>      Repeatable. Used by login and invite.
  --to <version>         Which version to roll back to.
  --lines <n>            How many log lines to show.
  --job <name>           Which job, for logs.
  --no-color             Plain output.
  -h, --help             This text.
  -v, --version          Version.
`;
function isVisibility(value) {
    return VISIBILITIES.includes(value);
}
export async function run(argv, output = consoleOutput) {
    let parsed;
    try {
        parsed = parseArgs({
            args: [...argv],
            allowPositionals: true,
            strict: true,
            options: {
                description: { type: 'string' },
                name: { type: 'string' },
                visibility: { type: 'string' },
                domain: { type: 'string' },
                admin: { type: 'string', multiple: true },
                email: { type: 'string', multiple: true },
                to: { type: 'string' },
                lines: { type: 'string' },
                job: { type: 'string' },
                table: { type: 'string', multiple: true },
                'no-database': { type: 'boolean' },
                force: { type: 'boolean' },
                all: { type: 'boolean' },
                'no-color': { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
            },
        });
    }
    catch (error) {
        output.err(error instanceof Error ? error.message : String(error));
        output.err('');
        output.err('Run `spry --help` to see what spry accepts.');
        return 2;
    }
    const { values, positionals } = parsed;
    if (values.version === true) {
        output.out(VERSION);
        return 0;
    }
    const command = positionals[0];
    if (values.help === true || command === undefined || command === 'help') {
        output.out(HELP);
        return command === undefined && values.help !== true ? 2 : 0;
    }
    const colour = values['no-color'] === true ? false : colourEnabled();
    const context = { output, colour, version: VERSION };
    const root = resolve(positionals[1] ?? '.');
    // Publish takes what was typed, not a resolved path: a repository is not a
    // path, and resolving one turns `github.com/acme/app` into a folder that does
    // not exist.
    const publishFrom = positionals[1] ?? '.';
    const emails = values.email ?? [];
    switch (command) {
        case 'login':
            return platform.login(context, emails[0]);
        case 'logout':
            return platform.logout(context, values.all === true);
        case 'whoami':
            return platform.whoami(context);
        case 'apps':
            return platform.apps(context);
        case 'data': {
            // `spry data export <page>`, `spry data log <page>`, or `spry data <page>` (D113).
            if (positionals[1] === 'log') {
                const page = positionals[2];
                if (page === undefined) {
                    output.err('Which page?');
                    output.err('');
                    output.err('  spry data log <page>');
                    return 2;
                }
                return pageAccessLog(context, page);
            }
            if (positionals[1] === 'export') {
                const page = positionals[2];
                if (page === undefined) {
                    output.err('Which page?');
                    output.err('');
                    output.err('  spry data export <page>');
                    return 2;
                }
                return exportPageData(context, page);
            }
            const page = positionals[1];
            if (page === undefined) {
                output.err('Which page?');
                output.err('');
                output.err('  spry data <page>');
                output.err('  spry data export <page>');
                return 2;
            }
            return showPageData(context, page);
        }
        case 'export': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app?');
                output.err('');
                output.err('  spry export <app>');
                return 2;
            }
            return platform.exportApp(context, slug);
        }
        case 'publish': {
            const visibilityRaw = values.visibility;
            if (visibilityRaw !== undefined && !isVisibility(visibilityRaw)) {
                output.err(`"${visibilityRaw}" is not a visibility. Use one of: ${VISIBILITIES.join(', ')}.`);
                return 2;
            }
            if (visibilityRaw === 'company' && values.domain === undefined) {
                output.err('Visibility "company" needs --domain, so Spryloom knows whose company.');
                output.err('');
                output.err('  spry publish report.html --visibility company --domain acme.com');
                return 2;
            }
            return platform.publish(context, {
                root: publishFrom,
                ...(values.name !== undefined && { name: values.name }),
                ...(values.description !== undefined && { description: values.description }),
                ...(visibilityRaw !== undefined && { visibility: visibilityRaw }),
                ...(values.domain !== undefined && { domain: values.domain }),
                ...(githubToken(process.env) !== undefined && { token: githubToken(process.env) }),
            });
        }
        case 'delete': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app?');
                output.err('');
                output.err('  spry delete <app> <app>');
                output.err('');
                output.err('The name twice, because deleting takes the data with it.');
                return 2;
            }
            return platform.remove(context, slug, positionals[2]);
        }
        case 'restart': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app?');
                output.err('');
                output.err('  spry restart <app>');
                return 2;
            }
            return platform.restart(context, slug);
        }
        case 'secrets': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app?');
                output.err('');
                output.err('  spry secrets <app> list');
                return 2;
            }
            // Everything after the action, so `set A=1 B=2` and `remove A B` both read
            // the way somebody would type them.
            return platform.secrets(context, slug, positionals[2], positionals.slice(3));
        }
        case 'invite': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app? For example: spry invite reconciler --email ryan@acme.com');
                return 2;
            }
            return platform.invite(context, slug, emails);
        }
        case 'uninvite': {
            const slug = positionals[1];
            const email = emails[0];
            if (slug === undefined || email === undefined) {
                output.err('Which app and email address? For example: spry uninvite reconciler --email ryan@acme.com');
                return 2;
            }
            return platform.uninvite(context, slug, email);
        }
        case 'domain':
            // spry domain <action> <app> [hostname]
            return platform.domain(context, positionals[1], positionals[2], positionals[3]);
        case 'jobs': {
            const first = positionals[1];
            const action = first === 'run' || first === 'resume' ? first : 'list';
            const slug = action === 'list' ? first : positionals[2];
            if (slug === undefined) {
                output.err('Which app? For example: spry jobs reconciler');
                return 2;
            }
            return platform.jobs(context, action, slug, action === 'list' ? undefined : positionals[3]);
        }
        case 'logs': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app? For example: spry logs reconciler');
                return 2;
            }
            if (values.job !== undefined)
                return platform.jobLogs(context, slug, values.job);
            return platform.logs(context, slug, Number.parseInt(values.lines ?? '100', 10) || 100);
        }
        case 'rollback': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app? For example: spry rollback reconciler');
                return 2;
            }
            const to = values.to === undefined ? undefined : Number.parseInt(values.to, 10);
            if (to !== undefined && !Number.isInteger(to)) {
                output.err('--to takes a version number, for example: --to 3');
                return 2;
            }
            return platform.rollback(context, slug, to);
        }
        case 'archive': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app?');
                output.err('');
                output.err('  spry archive <app>');
                return 2;
            }
            return platform.archive(context, slug);
        }
        case 'restore': {
            const slug = positionals[1];
            if (slug === undefined) {
                output.err('Which app?');
                output.err('');
                output.err('  spry restore <app>');
                return 2;
            }
            return platform.restore(context, slug);
        }
        case 'check':
            return check(root, context);
        case 'starter':
            return starter(positionals[1], positionals[2], context);
        case 'skill':
            return skill(root, { ...(values.force === true && { force: true }) }, context);
        case 'mcp': {
            // Loaded here rather than at the top, because the protocol machinery is
            // the largest thing this package can reach and no other command wants it.
            const { serveOverStdio } = await import('../mcp/index.js');
            // Returning does not end the process: the server is attached to stdin and
            // stays up until the agent closes it.
            await serveOverStdio(process.env, VERSION);
            return 0;
        }
        case 'init': {
            const visibilityRaw = values.visibility;
            if (visibilityRaw !== undefined && !isVisibility(visibilityRaw)) {
                output.err(`"${visibilityRaw}" is not a visibility. Use one of: ${VISIBILITIES.join(', ')}.`);
                return 2;
            }
            if (visibilityRaw === 'company' && values.domain === undefined) {
                output.err('Visibility "company" needs --domain, so Spryloom knows whose company.');
                output.err('');
                output.err('  spry init --visibility company --domain acme.com');
                return 2;
            }
            return init(root, {
                ...(values.name !== undefined && { name: values.name }),
                ...(values.description !== undefined && { description: values.description }),
                ...(visibilityRaw !== undefined && { visibility: visibilityRaw }),
                ...(values.domain !== undefined && { domain: values.domain }),
                ...(values.admin !== undefined && { admins: values.admin }),
                ...(values.table !== undefined && { tables: values.table }),
                ...(values['no-database'] === true && { noDatabase: true }),
                ...(values.force === true && { force: true }),
            }, context);
        }
        default:
            output.err(`"${command}" is not a spry command.`);
            output.err('');
            output.err('Available: login, publish, apps, data, export, invite, uninvite, secrets, logs, jobs, rollback, restart, archive, restore, delete, domain, starter, init, check, skill, mcp, whoami, logout.');
            output.err('Run `spry --help` for details.');
            return 2;
    }
}
/**
 * Was this file started as a program, rather than imported by a test?
 *
 * The obvious comparison — `import.meta.url` against `file://${process.argv[1]}`
 * — is wrong in the one case that matters most. npm installs a command as a
 * symbolic link in `node_modules/.bin`, so `argv[1]` is the link and
 * `import.meta.url` is the file it points at, and they never match: `spry`
 * exits zero having done nothing at all. It passed everywhere in this
 * repository, where the CLI is run by its real path, and failed on the first
 * machine that installed it. So the link is resolved, and the path is turned
 * into a URL rather than glued to a scheme, which is also the only spelling
 * Windows agrees with.
 */
function startedDirectly() {
    const invoked = process.argv[1];
    if (invoked === undefined)
        return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
    }
    catch {
        return false;
    }
}
if (startedDirectly()) {
    run(process.argv.slice(2))
        .then((code) => {
        process.exitCode = code;
    })
        .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=index.js.map