---
name: spryloom
description: Share a page you made with the user's team on Spryloom, behind sign-in. Use when the user wants to share, publish, host or send a link to a page, report, dashboard, prototype or artifact so coworkers, a partner or a client can open it ("share this with my team", "put this somewhere Tony can see it"); when they ask to invite someone to a Spryloom page; or when they ask what they have on Spryloom or whether a page is live.
---

# Sharing a page on Spryloom

Spryloom puts a page at its own address that only the people the user chooses
can open. They sign in with an emailed link; nobody needs an account or
anything installed. The user never deals with hosting.

This plugin's tools come from Spryloom's hosted connector:

| Tool | What it does |
|---|---|
| `publish_page` | Publish one self-contained HTML page, or a new version of it |
| `status` | Whether a page is live, its version and address |
| `invite` | Email people an invitation to a page |
| `list_apps` | What the user has on Spryloom |

The first call asks the user to connect Spryloom in their browser: an emailed
link and a code to compare. That happens once.

## 1. Ask one question

Before publishing, ask who may open it. Nothing else needs asking.

```
Who should be able to open it?
  1. Just you
  2. People you invite
  3. Anyone at <their company domain>
  4. Anyone with the link, after signing in
```

These are the `visibility` values `private`, `invited`, `company` and `link`.
Offer `company` only when the user has a company email address; with a
personal address such as gmail.com there is no company to limit it to.

## 2. Make it one self-contained HTML file

`publish_page` takes the page as a single HTML string, up to 512 KB.

- **Everything inline.** CSS in a `<style>`, scripts in a `<script>`, small
  images as `data:` URLs.
- **Libraries from a CDN only:** cdnjs.cloudflare.com, cdn.jsdelivr.net and
  unpkg.com for scripts and styles, Google Fonts for fonts. Browsers block
  anything else the page tries to load.
- **No outside calls.** A page's scripts cannot reach other websites or APIs, so
  fetch nothing at run time. Put the data in the page.
- **No secrets.** Never put an API key, password or token in a page; everyone
  who can open it can read its source.
- **A React artifact** becomes a plain page: load React and ReactDOM from
  unpkg.com, and either rewrite the JSX as `React.createElement` calls or load
  `@babel/standalone` and mark the script `type="text/babel"`. Replace imports
  of other packages with their CDN builds, or with plain code.
- **Saved state is per viewer.** `localStorage` keeps data in each person's own
  browser; coworkers will not see each other's entries. Say so if the page
  looks like a shared checklist or tracker, and see section 5.

Open the HTML once in your head as a coworker would: a title that says what it
is, readable on a phone, nothing that only made sense in the conversation.

## 3. Publish

Call `publish_page` with:

- `name`: a short human name, such as "Q3 vendor report". It becomes the
  address, so keep it to a few words.
- `html`: the whole file.
- `visibility`: from the question above.
- `description`: one sentence a coworker would understand.

**Publishing with a name that already exists replaces that page** with a new
version at the same address. If `list_apps` shows a page with that name and the
user did not ask to update it, ask before replacing it.

The tool answers straight away with the address while the page is stored.
Call `status` with the page's slug (the last part before the workspace in the
address) until it says the page is live, and only then tell the user:

```
Published: https://q3-vendor-report.acme.spryloom.app
Who can open it: people you invite

Want me to invite anyone?
```

If publishing fails, tell the user what the tool said, in its words. Do not
retry more than once.

## 4. Invite people

Only invite addresses the user gave you. Call `invite` with the slug and their
emails, then tell the user what each person gets: an email naming the page and
who invited them, with an **Open** button that signs them in. It works once,
for 7 days; after that they sign in with an emailed link.

For a `company` page, nobody needs inviting: everyone at the domain can sign
in. For `link`, the user can send the address themselves.

## 5. What a page can't do

A page is fixed content and its own scripts. If the user needs more, say what
and point them to Spryloom's guide at https://spryloom.com/docs rather than
attempting it here:

- **A list several people add to** (a sign-up sheet, an equipment checkout): a
  Spryloom page that saves data.
- **Email, a schedule, a database, or calls to other services:** a Spryloom app.

Both are published from a project folder with Spryloom's own tools, which the
guide explains. Offer to keep the page you made as a first version meanwhile.

## What not to do

- Do not publish before the user has said who may open it.
- Do not invite anyone the user did not name.
- Do not put credentials, personal data the user did not ask to share, or
  anything from other conversations into a page.
- Do not tell the user it is live before `status` says so.
