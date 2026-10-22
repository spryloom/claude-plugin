# Spryloom

Share a page you made with Claude with your team. Spryloom puts it at its own
address that only the people you choose can open: just you, people you invite,
everyone at your company, or anyone with the link after signing in. Coworkers
sign in with an emailed link and need no account.

This plugin has two parts and nothing that runs on your computer:

- **The Spryloom connector.** A hosted MCP server at
  `https://app.spryloom.com/mcp`. It publishes a page, checks whether it is
  live, invites people, and lists what you have on Spryloom.
- **The Spryloom skill.** It tells Claude to ask who may open the page, make it
  one self-contained HTML file, and confirm it is live before giving you the
  address.

## Setup

1. Install the plugin.
2. Make something, and say:

   > Share this with my team.

3. The first time, Claude asks you to connect Spryloom. You enter your email,
   Spryloom emails a link and shows a code to compare, and you approve the
   connection for your workspace. You can disconnect it at any time.

Spryloom is in a free, open beta. Anyone can sign in with an email address.

For apps with a database, scheduled jobs or email, see
[spryloom.com/docs](https://spryloom.com/docs).

## Privacy

Spryloom's privacy policy is at [spryloom.com/privacy](https://spryloom.com/privacy).
In short: Spryloom receives the pages you publish so it can serve them, and the
email addresses of the people you invite so it can send their invitations.
Every sign-in to a page is recorded in its access log. The connector asks only
for what its tools need: reading your list of pages, publishing pages, and
sending invitations.

## Support

[spryloom.com/docs/troubleshooting](https://spryloom.com/docs/troubleshooting),
or hello@spryloom.com.

## Licence

MIT. See [LICENSE](LICENSE).
