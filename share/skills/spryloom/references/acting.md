# Jobs, email and outside APIs

What an app can do when nobody has it open, and how to write it so it publishes
the first time.

## Scheduled jobs

A job is a script in the app, run on a schedule with the app's own database,
secrets and limits. Declare it; do not run a timer inside the server.

```yaml
jobs:
  - name: morning-reminder
    command: node jobs/remind.js
    schedule: "0 9 * * 1-5"
    timezone: America/New_York
```

- `schedule` is five-field cron. A job runs **at most once
  every 10 hours**: once or twice a day. `"0 9 * * *"` and `"0 9,19 * * *"` are
  fine; `"0 * * * *"` is refused.
- `timezone` is an IANA name such as `Europe/London`. Ask the user which time
  zone their team is in rather than assuming UTC.
- `timeout_minutes` defaults to 10 and may be at most 15. Keep a job short.
- The script must exit when it is done, with 0 on success. Close database
  pools before exiting, or the run waits until its time limit.
- A job that fails 5 times in a row is paused and its owner emailed.
- Never `setInterval` or a cron library inside the server for this. The server
  sleeps when nobody is using it, and the timer sleeps with it.

## Email to the people who use the app

```yaml
email: true
```

Write a small helper into the app as `spryloom-notify.js`, exporting
`notify({ to, subject, text, button, dedupeKey })`, that sends the request
shown at https://spryloom.com/docs/jobs-and-email#email-to-the-people-who-use-the-app. Retry it up to three times
on a network error or a 5xx answer, a second apart, and treat 202 as sent.
Spryloom lays out the email.

```js
import { notify } from './spryloom-notify.js';

await notify({
  to: approver.email,
  subject: '2 requests are waiting for your approval',
  text: 'Replace meeting-room monitor, and new chairs for room 4.',
  button: { label: 'Review requests', path: '/approvals' },
  dedupeKey: `reminder-${today}-${approver.id}`,
});
```

Rules, each of which is refused if broken:

- `to` must be someone invited to the app or who has signed in to it. Use the
  addresses the app already has from `x-spryloom-email`.
- `subject` up to 100 characters; `text` up to 500, plain, and **no web
  addresses at all**. Anything shaped like a domain is refused, including a
  file name such as `report.pdf` or a word like `Node.js`, and so are
  `mailto:` and `tel:`. Put the link in `button.path`, a path in the app, and
  keep names like those out of the text.
- **Don't put what people typed into `text`.** An item called "Dell monitor
  from dell.com" would get the whole email refused. Give counts, and let the
  button take them to the details: "3 requests are waiting for you".
- At most 5 a day per app. Send one digest rather than one
  email per item, and always pass a `dedupeKey` so a retry sends once.
- Never add nodemailer, an SMTP server or an email API. They cannot be reached,
  and they are not how Spryloom sends mail.

### Emailing the admins from a job

A job gets no request headers, so it doesn't know who the admins are. When a
job needs to email them, such as an approver's daily reminder, do this:

1. Have the server record each visitor's `x-spryloom-email` and `x-spryloom-role`
   in a `people` table as they use the app.
2. Have the job email the rows whose role is `admin`.

The owner is an admin, and is recorded the first time they open the app. Do not
ask the user to type their own address into a setting.

## Outside APIs

```yaml
egress:
  - slack.com
```

Only these hosts can be declared. Anything else is refused at publish:

`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`,
`api.stripe.com`, `slack.com`, `api.github.com`, `api.linear.app`, `api.notion.com`, `api.airtable.com`,
`api.hubapi.com`, and `sheets.googleapis.com` with `oauth2.googleapis.com`.

- Use plain `fetch` over HTTPS. Spryloom sets `HTTPS_PROXY` and
  `NODE_USE_ENV_PROXY`, so requests go through its gateway with no code change.
  Do not set a proxy or an agent yourself.
- Put every key in a secret the person sets as described at
  https://spryloom.com/docs/data#secrets. Never ask them to paste it into the conversation.
- **Slack is its bot API, not a webhook.** `hooks.slack.com` and `discord.com`
  are refused: anyone can create a webhook there, so an app could post its
  data to somebody else's account. Post with `chat.postMessage` at
  `https://slack.com/api/chat.postMessage` and a bot token the user installs.
- A host the API redirects to must be declared too, or the redirect is refused.
- If the user wants a service that is not listed, say so plainly and tell them
  they can ask at hello@spryloom.com. Do not work around it.
