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

- `schedule` is five-field cron. During the beta a job runs **at most once
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

Copy this helper into the app as `spryloom-notify.js` and use it. It sends a
notification through Spryloom, which lays out the email, and retries safely.

```js
// spryloom-notify.js: send a notification through Spryloom (D86).
export async function notify({ to, subject, text, button, dedupeKey }) {
  const url = `${process.env.SPRYLOOM_GATEWAY_URL}/v1/notify`;
  const body = JSON.stringify({ to, subject, text, button, dedupeKey });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.SPRYLOOM_GATEWAY_KEY}`,
          'content-type': 'application/json',
        },
        body,
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      continue;
    }
    const answer = await response.json().catch(() => ({}));
    if (response.status === 202) return answer;
    if (response.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      continue;
    }
    throw new Error(`${response.status} ${answer.error}: ${answer.message}`);
  }
}
```

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
- At most 5 a day per app during the beta. Send one digest rather than one
  email per item, and always pass a `dedupeKey` so a retry sends once.
- Never add nodemailer, an SMTP server or an email API. They cannot be reached,
  and they are not how Spryloom sends mail.

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
- Put every key in a secret and tell the user the command:
  `spry secrets my-app set SLACK_BOT_TOKEN=...`.
- **Slack is its bot API, not a webhook.** `hooks.slack.com` and `discord.com`
  are refused: anyone can create a webhook there, so an app could post its
  data to somebody else's account. Post with `chat.postMessage` at
  `https://slack.com/api/chat.postMessage` and a bot token the user installs.
- A host the API redirects to must be declared too, or the redirect is refused.
- If the user wants a service that is not listed, say so plainly and tell them
  they can ask at hello@spryloom.com. Do not work around it.
