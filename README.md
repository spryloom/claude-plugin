# Spryloom for Claude Code

Publish the app Claude Code just built to your team. Spryloom runs it at a
private address that only the people you invite can open, with a database,
scheduled jobs and email if the app asks for them. You don't set up a server,
a database or sign-in.

This plugin adds two things to Claude Code:

- **The Spryloom skill.** It teaches Claude to write apps that publish cleanly,
  and to publish them when you say "share this with my team".
- **The Spryloom MCP server.** It gives Claude the tools to publish, invite
  coworkers, read logs and roll back. It ships inside the plugin, under
  `server/`, and runs with the Node.js already on your machine. Nothing is
  downloaded when it starts.

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

   The first time, Claude asks for your email address. Spryloom emails you a
   link and Claude shows you a short code: open the link, check that the page
   shows the same code, and approve. There is no password, and you sign in
   once per machine.

   Claude then writes `spryloom.yaml`, publishes the app and gives you its
   address. Ask it to invite a coworker by email.

Signing in from Claude and `npx spryloom login --email you@yourcompany.com` in
a terminal are the same sign-in, kept in the same place, so either covers both.

## Privacy Policy

Spryloom's full privacy policy is at
[spryloom.com/privacy](https://spryloom.com/privacy). In short:

- When you publish, Spryloom receives the folder you publish, so it can build
  and run it. Files named `.env` or starting with `.env` are left out.
- Your app's database belongs to the app. Spryloom doesn't read inside it.
- Coworkers sign in with their email address, and Spryloom records each sign-in
  in the app's audit log.
- This plugin sends nothing anywhere on its own. The MCP server talks to
  Spryloom only when Claude calls one of its tools, and only as you.

## Documentation

- [Getting started](https://spryloom.com/docs)
- [Your app's manifest](https://spryloom.com/docs/manifest)
- Questions and feedback: [hello@spryloom.com](mailto:hello@spryloom.com)

## License

The contents of this repository (the skill and the plugin configuration) are
released under the MIT License. See [LICENSE](LICENSE). The Spryloom service
and the `spryloom` npm package have their own terms, at
[spryloom.com/terms](https://spryloom.com/terms).
