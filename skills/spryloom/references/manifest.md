# spryloom.yaml

Written by the coding agent while it builds the app. Spryloom provisions exactly
what this file declares, and the app's label page is generated from it, so a
coworker always sees what was really created.

## app

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Up to 60 characters. Shown in the dashboard and on the label page. |
| `slug` | no | Becomes part of the web address. Derived from the name when absent. Lowercase letters, digits and hyphens, up to 40 characters. |
| `description` | yes | One sentence, up to 200 characters. Appears in the invitation email and on the label page. |

## runtime

| Field | Values | Notes |
|---|---|---|
| `frontend` | `react`, `static`, `none` | |
| `backend` | `node`, `none` | |
| `build` | a command | Omit when there is no build step. |
| `start` | a command | Required when `backend` is not `none`. |
| `dockerfile` | a path | Only when the app supplies its own. It is then used as-is. |

An app with `frontend: none` and `backend: none` has nothing to run and is refused.

## access

| Field | Values | Notes |
|---|---|---|
| `visibility` | `private`, `invited`, `company`, `link` | Defaults to `private`. |
| `domain` | an email domain | Required when visibility is `company`. |
| `signin` | `google`, `email_link` | Defaults to both. |
| `admins` | email addresses | The publisher is always an admin. |

`link` still requires signing in. It removes the list of who may open the app,
not the front door.

## data

| Field | Notes |
|---|---|
| `postgres` | `true` gives the app a database, reachable through `DATABASE_URL`. |
| `tables` | The tables the app stores. Shown on the label page, so a coworker can see what it holds. Required when `postgres` is true. |
| `uploads` | `false`. `true` is refused: file uploads are not available yet. |
| `lists` | Pages only: lists a page's scripts save at `/~data`, each `shared` or `own`. Names are lowercase letters, digits and hyphens; at most 20. An app is refused lists: it has its own database. |

Declaring tables without a database, or a database without tables, is refused.
The first is a contradiction; the second leaves the label page unable to say what
the app stores.

## jobs, email, egress

| Field | Notes |
|---|---|
| `jobs` | Work on a schedule: `name`, `command`, five-field cron `schedule`, optional `timezone` and `timeout_minutes`. At most once every 10 hours. |
| `email` | `true` lets the app email the people who use it, as notifications through Spryloom. |
| `egress` | Outside hosts the app may reach, each from Spryloom's list. |

All three are in `references/acting.md`. Without them an app reaches its own
database and nothing else: no web, no mail, no other app.

## Not yet available

File uploads. `uploads: true` is refused with a message saying so, so keep what
matters in the database. Outside services not on Spryloom's list are refused
too; the list is in `references/acting.md`.

## Never put in this file

Secrets. It is committed to the repository. Use `spry secrets set NAME` and read
the value from the environment.
