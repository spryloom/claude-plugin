# Spryloom for Claude Code

> Spryloom's main repository is
> [spryloom/spryloom](https://github.com/spryloom/spryloom): the skill, the
> setup for Codex and Cursor, the source of the MCP server, and starter apps.
> Star it, open issues there, and link to it. This repository is the Claude Code
> plugin built from it, with a hosted MCP connector and a publishing skill.

Publish the app Claude Code just built to your team. Spryloom runs it at a
private address that only the people you invite can open, with a database,
scheduled jobs and email if the app asks for them. You don't set up a server,
a database or sign-in.

This plugin adds two things to Claude Code:

- **The Spryloom skill.** It teaches Claude to write apps that publish cleanly,
  and to publish them when you say "share this with my team".
- **The Spryloom connector.** Sign in through Spryloom to publish HTML pages,
  list apps, check status and invite coworkers. Project folders use the `spry`
  command in Claude Code's terminal, where their files are available.

Spryloom is in a free, open beta. Anyone can sign in with an email address;
nobody has to approve you.

## Setup

You need Node.js 20.19 or later.

1. Install the plugin in Claude Code:

   ```
   /plugin marketplace add spryloom/claude-plugin
   /plugin install spryloom@spryloom
   ```

2. Build something, and ask:

   > Publish this so my team can use it.

   For a project folder, Claude asks you to sign in with `spry login` once on
   that machine, then publishes the folder. For an HTML page, connect the
   hosted MCP server in `/mcp`: Spryloom emails a link, shows a code to compare,
   and asks you to approve the connector for your workspace.

   Claude then writes `spryloom.yaml`, publishes the app and gives you its
   address. Ask it to invite a coworker by email.

The connector sign-in and terminal sign-in are separate credentials. You can
disconnect the connector without signing out of the CLI.

## Privacy Policy

Spryloom's full privacy policy is at
[spryloom.com/privacy](https://spryloom.com/privacy). In short:

- When you publish, Spryloom receives the folder you publish, so it can build
  and run it. Files named `.env` or starting with `.env` are left out.
- Your app's database belongs to the app. Spryloom doesn't read inside it.
- Coworkers sign in with their email address, and Spryloom records each sign-in
  in the app's audit log.
- The plugin carries no local server or stored credential. The remote connector
  talks to Spryloom when Claude calls one of its tools, under your grant.

## Documentation

- [Getting started](https://spryloom.com/docs)
- [Your app's manifest](https://spryloom.com/docs/manifest)
- Questions and feedback: [hello@spryloom.com](mailto:hello@spryloom.com)

## License

The skill and the plugin configuration are released under the MIT License. See
[LICENSE](LICENSE). The separate `spryloom` npm package is also MIT. The Spryloom service has its
own terms, at [spryloom.com/terms](https://spryloom.com/terms).
