# Spryloom

Build something with Claude and share it with your team. Spryloom runs it at its
own address that only the people you choose can open: just you, people you
invite, everyone at your company, or anyone with the link after signing in.
Coworkers sign in with an emailed link and need no account.

It can be a page (a report, a dashboard, an artifact), a page that saves data (a
checklist or sign-up sheet several people use), or an app with a database,
scheduled jobs and email. Claude writes it, publishes it, follows the build,
fixes what fails, and invites people for you.

This plugin has two parts and nothing that runs on your computer:

- **The Spryloom connector.** A hosted MCP server at
  `https://app.spryloom.com/mcp`. It publishes apps and pages, follows a
  publish, reads an app's logs, rolls back a version, and adds or removes the
  people who can use it.
- **The Spryloom skill.** It tells Claude how to build something that publishes
  first time, asks who may use it, and confirms it is live before giving you the
  address.

## Setup

1. Install the plugin.
2. Make something, and say:

   > Make a checklist for our month-end close, and share it with the finance team.

3. The first time, Claude asks you to connect Spryloom. You enter your email,
   Spryloom emails a link and shows a code to compare, and you approve the
   connection for your workspace. You can disconnect it at any time.

Spryloom is in a free, open beta. Anyone can sign in with an email address.

Secrets such as API keys are set outside the conversation; see
[spryloom.com/docs/data#secrets](https://spryloom.com/docs/data#secrets).

## Privacy

Spryloom's privacy policy is at [spryloom.com/privacy](https://spryloom.com/privacy).
In short: Spryloom receives the apps and pages you publish so it can build, run
and serve them, and the email addresses of the people you invite so it can send
their invitations. An app's database belongs to the app; Spryloom doesn't read
inside it.
Every sign-in to a page is recorded in its access log. The connector asks only
for what its tools need: seeing your apps and pages and their logs, publishing
pages, publishing apps and rolling them back, and inviting and removing people.

## Support

[spryloom.com/docs/troubleshooting](https://spryloom.com/docs/troubleshooting),
or hello@spryloom.com.

## Licence

MIT. See [LICENSE](LICENSE).
