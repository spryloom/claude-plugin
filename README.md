# Spryloom for Claude Code

Publish the app Claude Code just built to your team. Spryloom runs it at a
private address that only the people you invite can open, with a database,
scheduled jobs and email if the app asks for them. You don't set up a server,
a database or sign-in.

This plugin adds two things to Claude Code:

- **The Spryloom skill.** It teaches Claude to write apps that publish cleanly,
  and to publish them when you say "share this with my team".
- **The Spryloom MCP server.** It gives Claude the tools to publish, invite
  coworkers, read logs and roll back. It runs through `npx spryloom mcp`.

Spryloom is in an invite-only beta. Request access at
[spryloom.com](https://spryloom.com/#invite).

## Setup

You need Node.js 20.19 or later.

1. Install the plugin in Claude Code:

   ```
   /plugin marketplace add spryloom/claude-plugin
   /plugin install spryloom@spryloom
   ```

2. Sign in once, in a terminal:

   ```
   npx spryloom login --email you@yourcompany.com
   ```

   Spryloom emails you a link. Open it, check that the page shows the same
   code as your terminal, and confirm. There is no password.

3. Restart Claude Code, build something, and ask:

   > Publish this so my team can use it.

   Claude writes `spryloom.yaml`, publishes the app and gives you its address.
   Then ask it to invite a coworker by email.

The MCP server acts as whoever the terminal is signed in as. If you'd rather
pass a token, set `SPRYLOOM_TOKEN` in the environment Claude Code runs in.

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
