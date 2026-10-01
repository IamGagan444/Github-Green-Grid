# GreenGrid

GreenGrid is a multi-user SaaS that automates two things around your GitHub
work:

1. **Daily standup automations (GitHub → Slack).** Each automation reads the
   commits *you* authored today in the repositories and branches you choose,
   has NVIDIA Nemotron (`nvidia/nemotron-3-super-120b-a12b`) turn them into
   concise standup bullets, and posts them to a Slack channel — as a reply under
   one shared daily date-header thread — on your schedule, in your timezone.
   Every run is idempotent: one update per automation per day, never duplicated.
2. **Commit activity schedules.** Pick a repository you can write to, configure
   a schedule, and GreenGrid performs a small, real repository maintenance
   update on the days you chose — one commit per run through GitHub's official
   REST API, attributed to your own GitHub account.

You sign in with Google; GitHub and Slack are integrations you connect from
Settings. Administrators get a separate panel for users, automations,
executions, integrations, audit logs and system health.

**GreenGrid does not control GitHub's contribution graph.** It creates real
commits; GitHub independently decides which commits appear on your profile,
based on its own [contribution rules][gh-contrib]. GreenGrid never promises a
green square.

What GreenGrid explicitly does **not** do:

- no scraping of GitHub,
- no browser automation,
- no fabricated commit author identities,
- no direct manipulation of the contribution graph.

[gh-contrib]: https://docs.github.com/account-and-profile/setting-up-and-managing-your-github-profile/managing-contribution-settings-on-your-profile/why-are-my-contributions-not-showing-up-on-my-profile

---

## Table of contents

- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Standup automations](#standup-automations)
- [Roles and access control](#roles-and-access-control)
- [Local development](#local-development)
- [Google sign-in setup](#google-sign-in-setup)
- [GitHub OAuth setup](#github-oauth-setup)
- [Required GitHub permissions](#required-github-permissions)
- [Slack app setup](#slack-app-setup)
- [NVIDIA API setup](#nvidia-api-setup)
- [Upgrading an existing GreenGrid deployment](#upgrading-an-existing-greengrid-deployment)
- [Database setup](#database-setup)
- [Environment variables](#environment-variables)
- [Prisma migrations](#prisma-migrations)
- [Cron configuration](#cron-configuration)
- [Vercel deployment](#vercel-deployment)
- [Testing](#testing)
- [Security considerations](#security-considerations)
- [Contribution rules disclaimer](#contribution-rules-disclaimer)

---

## Tech stack

| Layer      | Choice                                                      |
| ---------- | ----------------------------------------------------------- |
| Framework  | Next.js 16 (App Router, React 19, Turbopack)                 |
| Language   | TypeScript, `strict` + `noUncheckedIndexedAccess`            |
| Styling    | Tailwind CSS v4, shadcn/ui-style components on Radix         |
| Icons      | Lucide React                                                 |
| Forms      | React Hook Form + Zod                                        |
| Database   | PostgreSQL via Prisma 7 (`@prisma/adapter-pg` driver adapter)|
| GitHub API | Octokit (`octokit`), official REST API only                  |
| Slack API  | Slack Web API over `fetch` (OAuth v2, bot + optional user tokens) |
| AI         | NVIDIA Nemotron via the OpenAI-compatible NVIDIA API, Zod-validated output |
| Auth       | Auth.js v5 (Google), database sessions with hashed tokens    |
| Scheduling | External cron hitting `CRON_SECRET`-protected endpoints      |
| Tests      | Vitest (GitHub, Slack, AI and database access fully mocked)  |

## Architecture

```
src/
  app/
    page.tsx  login/  privacy/  terms/     Public pages
    actions/auth.ts                        Sign-in / sign-out server actions
    (app)/                                 Authenticated shell (server-side guard)
      dashboard/                           Overview + commit-activity pages
      automations/  [id]/  [id]/edit/  new/  8-step automation wizard
      executions/   [id]/                  Execution history + detail
      settings/                            Profile, integrations, defaults, security, account
      admin/                               Users, automations, executions,
                                           integrations, audit logs, system
    api/
      auth/[...nextauth]                   Auth.js (Google)
      auth/github/callback                 GitHub integration callback
      integrations/github/…  slack/…       Connect, disconnect, repos, branches, channels
      automations/…  executions/…          CRUD, pause/resume, test (dry run), run now
      admin/…                              Enable/disable users and automations
      cron/standups  cron/activity         Scheduler entry points
      webhooks/slack/events                Signed Slack events (uninstall/revoke)

  lib/
    auth/        Auth.js config, hashed-session adapter, sign-in policy, guards
    rbac/        Permissions, assertPermission, assertResourceAccess (IDOR)
    github/      Octokit client (token refresh), repos, branches, commit fetch + filter
    slack/       Web API client, OAuth v2, message building, thread detection, signatures
    ai/          Nemotron client, prompt, Zod output schema
    automation/  Pure schedule math, execution engine (ports), takeover rules
    scheduler/   Due selection, time-budgeted runner, cron auth
    logging/     Structured JSON logger with secret redaction
    errors.ts    Typed AppError codes with user-safe messages and retry class
    retry.ts     Exponential backoff with jitter + Retry-After
    encryption.ts  AES-256-GCM, HMAC, constant-time compare
    oauth-state.ts Single-use, user-bound OAuth state cookies
  services/      github-, slack-, ai-, automation-, execution-, audit-, admin-,
                 dashboard-service — the only layer routes and pages call
  validators/    Zod schemas for automations and queries
  types/         Auth.js module augmentation
```

**Layering rule:** UI components never call GitHub, Slack or NVIDIA. Pages and
route handlers call `services/*`; services call the provider modules in
`lib/github`, `lib/slack` and `lib/ai`, which are the only places those APIs are
contacted. The execution engine (`lib/automation/engine.ts`) depends only on
ports (interfaces), so its duplicate-protection guarantees are tested against
in-memory fakes.

### Request flow for a scheduled run

```
External cron (Vercel Cron, GitHub Actions, cron-job.org, …)
        │  POST /api/cron/activity   Authorization: Bearer <CRON_SECRET>
        ▼
constant-time secret check
        ▼
find enabled schedules → getDueOccurrences() per schedule (timezone-aware)
        ▼
for each due slot, independently:
    insert ActivityExecution
      (unique idempotencyKey "<scheduleId>:<localDay>:<slotIndex>")
        │ duplicate → SKIPPED, no GitHub call
        ▼
    verify write access → read .greengrid/activity.json → increment
        ▼
    commit via GitHub Contents API → record COMPLETED / FAILED
        ▼
{ "processed": 12, "successful": 10, "failed": 2, "skipped": 0 }
```

### The activity model

GreenGrid maintains a single JSON file — `.greengrid/activity.json` by default,
configurable per schedule:

```json
{
  "version": 1,
  "lastActivity": "2026-09-01",
  "runs": 43,
  "history": ["2026-08-31", "2026-09-01"]
}
```

Each execution increments `runs`, sets `lastActivity`, and records the day in a
capped 30-entry history of *distinct* active days. **One scheduled execution
creates exactly one commit.** The default commit message is
`chore: update GreenGrid activity`; it is configurable, validated to a single
line of at most 72 characters.

### Commits per day

A schedule sets **how many** commits it makes on each selected day (1-20), never
**when**. The clock times are derived: one commit per hour, in a contiguous
window anchored at 09:00 local time and slid earlier only as far as needed so
every slot stays inside the same local calendar day.

| commitsPerDay | Local slot times    |
| ------------: | ------------------- |
|             1 | 09:00               |
|             5 | 09:00-13:00         |
|            12 | 09:00-20:00         |
|            20 | 04:00-23:00         |

Deriving the times server-side means the client cannot request an arbitrary
firing schedule, and it keeps every commit of a day in one contribution bucket.

Higher counts are visibly automated. GitHub's Acceptable Use Policies still
apply, and a large number of bot commits per day to a single file is the kind of
activity that draws attention — 1-3 reads as ordinary maintenance.

## Standup automations

An automation holds a GitHub source (1–5 repositories, each one branch or all
branches, same-day or previous-day commits), an AI style and optional quick
note, a Slack destination (workspace, channel, bot or "Post as me"), a thread
style, and a schedule (days, `HH:MM`, IANA timezone). Statuses are `ACTIVE`,
`PAUSED` (owner) and `DISABLED` (admin only; the owner cannot resume it).

### Execution flow

```
POST /api/cron/standups  (every 5–15 min, Bearer CRON_SECRET)
  ▼
ACTIVE automations whose owner is ACTIVE and whose GitHub + Slack
integrations are CONNECTED
  ▼
getDueRun(): scheduled HH:MM on a selected weekday *in the automation's
timezone*, within a 6-hour grace window (also checks the previous local day)
  + FAILED executions whose retry time has arrived
  ▼
claim Execution (unique idempotencyKey "<automationId>:<localDate>")
  ├─ SUCCESS already          → no-op
  ├─ RUNNING, live lease      → no-op (another worker has it)
  └─ new / expired lease / due retry → this worker owns it
  ▼
GitHub: commits authored by the connected user in [local midnight, next
local midnight), per branch or all branches (deduped), merges dropped
  └─ none → SKIPPED (nothing posted)
  ▼
Nemotron → JSON {"summary": [...]} → Zod validation (shape, length, no Slack
control syntax, no meaningless or duplicate bullets, ≤ one bullet per commit)
  └─ invalid → retried with backoff; never posted if still invalid
  ▼
Slack: find today's parent (DB anchor → channel history by metadata or exact
header text) or create "📅 Wednesday, September 30, 2026"; reply in thread
with metadata {execution_key}
  ▼
store parent ts, reply ts, permalink → SUCCESS, audit AUTOMATION_EXECUTED
```

### Duplicate protection

- `Execution.idempotencyKey` is unique per automation per local date, so only
  one row — and one owner — can exist for a day, whether triggered by the
  scheduler or **Run now**.
- AI output and the parent `ts` are saved as soon as they exist; a resumed run
  reuses them instead of generating a different message or a second parent.
- Every Slack post carries message metadata with the execution key. Before
  posting on a resumed attempt, the thread is scanned for that key, so a crash
  between "posted" and "saved" cannot create a second message.
- `SlackThreadAnchor` is unique per (team, channel, date, header), so concurrent
  automations posting to one channel converge on a single daily parent.

**Test Automation** is a dry run: it uses real GitHub data, a real Nemotron
summary and a real Slack channel-access check, shows the exact message, and
posts nothing. **Run now** posts for real and counts as that day's update.

### Retry policy

Transient provider failures (rate limits with `Retry-After`, 5xx, timeouts,
invalid AI output) are retried in-process with exponential backoff and jitter,
then re-attempted by the scheduler at 10 and 20 minutes (3 attempts total).
Permanent failures — revoked tokens, missing scopes, archived channels,
unavailable repositories, invalid timezones — are recorded with a user-facing
reason and not retried. A GitHub 401 or Slack `token_revoked` flips that
integration to `REVOKED` and the UI asks the user to reconnect.

## Roles and access control

New users always get role `USER`; the role cannot be chosen in the app. Grant
the first administrator from a machine with database access:

```bash
npm run admin:grant -- you@example.com          # promote
npm run admin:grant -- you@example.com --revoke # demote
```

Every sensitive operation checks, on the server: authentication → account
status (`DISABLED` users are signed out everywhere and cannot sign in) → role
permission (`lib/rbac`) → resource ownership. Mutations look records up by
`{ id, userId }`, and another user's resource is reported as `404`, so IDs
cannot be probed. Admins can read all automations and executions and
enable/disable users and automations, but cannot edit or delete another user's
automation, run it, or see any OAuth token — admin queries never select
credential columns.

## Local development

Requirements: Node.js 20+ (developed on 24) and a PostgreSQL database.

```bash
npm install
cp .env.example .env.local     # then fill in the values
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open http://localhost:3000.

Available scripts:

| Command             | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Development server                          |
| `npm run build`     | `prisma generate` + production build        |
| `npm start`         | Serve the production build                  |
| `npm run lint`      | ESLint (flat config, `eslint-config-next`)  |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm test`          | Vitest suite                                |
| `npm run admin:grant -- <email>` | Promote a user to ADMIN (`--revoke` to demote) |
| `npm run db:migrate`| `prisma migrate dev`                        |
| `npm run db:deploy` | `prisma migrate deploy` (production)        |
| `npm run db:studio` | Prisma Studio                               |

> The Prisma client is generated into `src/generated/prisma` (gitignored), so
> run `npx prisma generate` after cloning or after changing the schema.

## Google sign-in setup

1. Google Cloud console → **APIs & Services → Credentials → Create credentials
   → OAuth client ID** → *Web application*.
2. Authorized redirect URI: `<NEXT_PUBLIC_APP_URL>/api/auth/callback/google`
   (e.g. `http://localhost:3000/api/auth/callback/google`).
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
   and generate `AUTH_SECRET` (`openssl rand -base64 32`).

Only verified Google emails can sign in. Google tokens are discarded after
sign-in — only the identity is stored.

## GitHub OAuth setup

GitHub is an *integration*, connected from Settings after sign-in. A **GitHub
App** is recommended (fine-grained, per-repository access and expiring,
refreshable user tokens); a classic OAuth App also works.

**GitHub App (recommended).** <https://github.com/settings/apps> → **New GitHub App**:

- **Callback URL:** `<NEXT_PUBLIC_APP_URL>/api/auth/github/callback`
- **Request user authorization (OAuth) during installation:** on;
  **Expire user authorization tokens:** on (GreenGrid refreshes them).
- **Repository permissions:** *Contents: Read and write* (read commits for
  standups; write only for commit-activity schedules — use *Read-only* if you
  do not use that feature), *Metadata: Read-only*.
- **Account permissions:** *Email addresses: Read-only*.
- Install the App on the accounts/repositories users should be able to select,
  and set `GITHUB_APP_SLUG` to show a "Manage repository access" link.

Copy the App's Client ID/secret into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
The callback path is the same one earlier GreenGrid versions used, so an
existing App keeps working.

### The OAuth flow

1. `GET /api/integrations/github/connect` (signed-in users only) mints a random
   `state` bound to the user, stores it in an httpOnly cookie and redirects.
2. `/api/auth/github/callback` verifies the state and that the same user is
   still signed in, exchanges the code server-side, encrypts the tokens and
   links the GitHub identity to the user. One GitHub identity can be connected
   to one GreenGrid user.

## Required GitHub permissions

With a classic OAuth App, GreenGrid requests these scopes:

| Scope        | Why                                                                     |
| ------------ | ----------------------------------------------------------------------- |
| `repo`       | Read repository metadata and permissions, and commit the activity file. GitHub provides no narrower scope for writing to a **private** repository through the Contents API. |
| `read:user`  | Username, display name and avatar shown in the dashboard.               |
| `user:email` | Primary verified email, used only to identify the account.              |

If you only ever intend to automate **public** repositories, you can narrow the
scope by editing `OAUTH_SCOPES` in `src/lib/github/oauth.ts` from `repo` to
`public_repo`.

Before enabling automation, GreenGrid verifies for the selected repository that:

- you have push (or maintain/admin) permission,
- the repository is not archived,
- the default branch exists.

Repositories failing any of these checks cannot be selected or scheduled.

Standup automations only **read**: the repository list, branches, and commits
filtered by `author=<your login>` and the day's time window. Every selected
repository and branch is re-verified with the user's own token when an
automation is saved.

## Slack app setup

Create an app at <https://api.slack.com/apps> → **From scratch**.

1. **OAuth & Permissions → Redirect URLs:**
   `<NEXT_PUBLIC_APP_URL>/api/integrations/slack/callback` (HTTPS required;
   use a tunnel such as `ngrok` for local development).
2. **Bot token scopes:** `chat:write`, `channels:read`, `groups:read`,
   `channels:history`, `groups:history`, `channels:join`. These are the defaults
   when `SLACK_BOT_SCOPES` is empty.
3. **User token scopes** (for "Post as me"): `chat:write`, `channels:read`,
   `groups:read`, `channels:history`, `groups:history`. One Connect requests the
   bot and user scopes together, so every automation can post as the app or as
   the user. These are the defaults when `SLACK_USER_SCOPES` is empty; set it to
   `none` to offer bot posting only. The Slack app must list every requested
   scope, or Slack rejects the install with `invalid_scope`.
4. **Basic Information:** copy Client ID, Client Secret and Signing Secret into
   `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
5. Optional: **Event Subscriptions** → Request URL
   `<NEXT_PUBLIC_APP_URL>/api/webhooks/slack/events`, subscribe to the bot
   events `app_uninstalled` and `tokens_revoked`. Every request's signature and
   timestamp are verified.
6. To post to a workspace other than your own, enable **Manage Distribution**.

Bot posting joins public channels automatically; for private channels, invite
the app first (`/invite @YourApp`). "Post as me" posts with the user's own token
— it is never simulated with the bot token. Token rotation is supported: if
Slack issues refresh tokens, they are stored encrypted and used automatically.

## NVIDIA API setup

Create an API key at <https://build.nvidia.com> and set `NVIDIA_API_KEY`.
`NVIDIA_BASE_URL` defaults to `https://integrate.api.nvidia.com/v1` and
`NVIDIA_MODEL` to `nvidia/nemotron-3-super-120b-a12b`. Only commit messages
(plus optional file names/line counts and the user's note) are sent — never
source code — and only from the server.

## Upgrading an existing GreenGrid deployment

The `20260930000000_standup_automations` migration:

- renames `github_accounts` → `github_integrations` in place (stored tokens are
  kept, now nullable so disconnecting can wipe them),
- adds identity, role and status columns to `users`, and the new `accounts`,
  `slack_integrations`, `automations`, `executions`, `slack_thread_anchors`,
  `audit_logs` and `cron_runs` tables,
- **deletes all rows in `sessions`** — everyone signs in again with Google.

Users who previously signed in with GitHub sign in with Google and then connect
the same GitHub account; GreenGrid recognises the earlier account (it has no
email) and moves its repositories, schedules and history to the new user. Set
the new variables (`AUTH_SECRET`, `GOOGLE_*`, Slack, NVIDIA); the old
`GITHUB_TOKEN_ENCRYPTION_KEY` keeps working, or rename it to `ENCRYPTION_KEY`
with the same value.

## Database setup

Any PostgreSQL 13+ database works — Neon, Supabase, Railway, RDS, or local
Postgres.

```bash
# Local Postgres example
createdb greengrid
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/greengrid"
```

Hosted providers usually require `?sslmode=require` on the connection string.
Prisma 7 connects through the `pg` driver adapter configured in `src/lib/db.ts`;
the CLI reads `DATABASE_URL` through `prisma.config.ts`.

### Schema

| Model               | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `User`              | Google identity, `role` (USER/ADMIN), `status` (ACTIVE/DISABLED), defaults |
| `Account`           | Auth.js provider link (no provider tokens stored)              |
| `Session`           | Auth.js database session; only the token hash is stored        |
| `GitHubIntegration` | One per user; encrypted tokens, status, profile fields         |
| `SlackIntegration`  | Per user per workspace; encrypted bot/user tokens, scopes, status |
| `Automation`        | Standup automation configuration and status                    |
| `Execution`         | One row per automation per local day (unique idempotency key), step statuses, AI output, Slack ts |
| `SlackThreadAnchor` | One daily parent per channel/date/header (unique)              |
| `AuditLog`          | Actor, action, target, sanitised metadata                      |
| `CronRun`           | Scheduler tick history for the admin System page               |
| `Repository`        | Mirror of the repositories you can act on; one `selected`      |
| `Schedule`          | enabled / timezone / commitsPerDay / daysOfWeek / commit message |
| `ActivityExecution` | One row per run, with status, commit SHA/URL and error message |

All timestamps are stored in UTC. Timezone handling lives entirely in
`src/lib/schedule/timezone.ts` using the `Intl` API, so DST transitions are
handled correctly without a date library.

## Environment variables

Copy `.env.example` to `.env.local`. Every variable is validated at runtime by
`src/lib/env.ts`; a missing or malformed value fails fast with the *names* of
the offending keys and never their values.

| Variable                      | Required | Purpose                                                                 |
| ----------------------------- | :------: | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`         |    ✅    | Public origin; OAuth redirect URIs and the CSRF origin check.           |
| `DATABASE_URL`                |    ✅    | PostgreSQL connection string.                                           |
| `AUTH_SECRET`                 |    ✅    | Auth.js secret.                                                         |
| `GOOGLE_CLIENT_ID` / `_SECRET`|    ✅    | Google OAuth client.                                                    |
| `GITHUB_CLIENT_ID` / `_SECRET`|    ✅    | GitHub App (or OAuth App) credentials.                                  |
| `GITHUB_APP_SLUG`             |    —     | Enables the "Manage repository access" link.                            |
| `SLACK_CLIENT_ID` / `_SECRET` |  Slack   | Slack app credentials. Without them, Slack features are disabled.       |
| `SLACK_SIGNING_SECRET`        |    —     | Enables the signed Events endpoint.                                     |
| `SLACK_BOT_SCOPES`            |    —     | Comma-separated; sensible defaults when empty.                          |
| `SLACK_USER_SCOPES`           |    —     | "Post as me" scopes (sensible default); `none` disables it.             |
| `NVIDIA_API_KEY`              |    AI    | Required to generate summaries.                                         |
| `NVIDIA_BASE_URL` / `NVIDIA_MODEL` | — | Default to the NVIDIA endpoint and Nemotron 3 Super.                    |
| `CRON_SECRET`                 |    ✅    | Bearer secret for `/api/cron/*`.                                        |
| `ENCRYPTION_KEY`              |    ✅    | Base64 of **32 random bytes**; AES-256-GCM key for tokens at rest. (`GITHUB_TOKEN_ENCRYPTION_KEY` accepted for existing deployments.) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Distributed rate limiting (recommended with multiple instances).    |
| `LOG_LEVEL`                   |    —     | `debug`, `info`, `warn`, `error`.                                       |

Generate the secrets:

```bash
# ENCRYPTION_KEY (must decode to exactly 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# AUTH_SECRET and CRON_SECRET
openssl rand -base64 32
```

`NEXT_PUBLIC_APP_URL` is the only public variable and holds no secret. Rotating
`ENCRYPTION_KEY` invalidates every stored token — users will be asked to
reconnect GitHub and Slack. The admin **System** page shows which areas are
configured (never the values).

## Prisma migrations

```bash
npx prisma generate          # regenerate the client after schema changes
npx prisma migrate dev       # create + apply a migration in development
npx prisma migrate deploy    # apply pending migrations in production
```

Migrations are committed under `prisma/migrations/`. On a fresh database,
`npx prisma migrate deploy` is enough to create the full schema; on an existing
one it applies `20260930000000_standup_automations` (see
[Upgrading](#upgrading-an-existing-greengrid-deployment)).

## Cron configuration

The scheduler is entirely external — GreenGrid never relies on an in-process
`setTimeout` or `setInterval`, so it works on serverless platforms.

**Endpoints:** `POST /api/cron/standups` (standup automations) and
`POST /api/cron/activity` (commit-activity schedules). `GET` is accepted too,
for schedulers such as Vercel Cron that only issue GETs. The shipped GitHub
Actions workflow calls both every 15 minutes.

`/api/cron/standups` processes due automations with bounded concurrency inside
a 45-second budget; anything not reached is picked up on the next tick, which
the idempotency key makes safe. Each tick is recorded in `cron_runs` and shown
on **Admin → System**. Because due-ness is computed per automation in its own
IANA timezone (never the server's), "Monday–Friday 5:00 PM Asia/Kolkata" fires
at 11:30 UTC on those days, and DST zones shift correctly.

The rest of this section describes `/api/cron/activity`.

**Auth:** `Authorization: Bearer <CRON_SECRET>`, compared in constant time.

```bash
curl -X POST https://your-app.vercel.app/api/cron/activity \
  -H "Authorization: Bearer $CRON_SECRET"

# {"processed":12,"successful":10,"failed":2,"skipped":0}
```

**Required frequency: at least hourly; every 15 minutes recommended.** Slots are
one hour apart, so a cron that runs less often than hourly will miss commits.

For each enabled schedule the endpoint computes which slots are due *right now*
in that schedule's own timezone, allowing a 90-minute grace window. A missed poll
therefore catches up on the next tick (several slots can run in one batch)
rather than dropping commits, while a slot missed by many hours is not silently
backfilled.

**Idempotency.** Each scheduled run inserts an `ActivityExecution` whose
`idempotencyKey` is `"<scheduleId>:<localDay>:<slotIndex>"` under a unique index.
A repeated delivery for the same schedule, local day and slot is rejected by the
database and returns `SKIPPED` without touching GitHub. Retryable failures (rate
limits, conflicts, GitHub outages) clear the key so the next poll can try again;
permanent failures keep it so the slot is not retried in a loop.

**Isolation.** Every schedule is processed in its own `try`/`catch`. One user's
failure never aborts the batch.

Alternatives to Vercel Cron:

```yaml
# .github/workflows/cron.yml
name: GreenGrid scheduler
on:
  schedule:
    - cron: "*/15 * * * *"
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: |
          for endpoint in activity standups; do
            curl -fsS -X POST "$APP_URL/api/cron/$endpoint" \
              -H "Authorization: Bearer $CRON_SECRET"
          done
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

## Vercel deployment

1. Push the repository to GitHub and import it into Vercel.
2. Add every variable from the table above under **Settings → Environment
   Variables** (`NEXT_PUBLIC_APP_URL` must be the deployed origin).
3. Set the build command to `npm run build` — it runs `prisma generate` first.
4. Apply migrations against the production database:
   `DATABASE_URL=... npx prisma migrate deploy`.
5. Set up the scheduler. `vercel.json` ships with `"crons": []` on purpose:
   Vercel's Hobby plan runs cron jobs **at most once per day**, which would cap
   the app at one commit per day regardless of `commitsPerDay`. The scheduler
   therefore lives in GitHub Actions
   (`.github/workflows/main.yml`), which polls every 15 minutes. Add two
   repository secrets under **Settings → Secrets and variables → Actions**:

   | Secret        | Value                                             |
   | ------------- | ------------------------------------------------- |
   | `APP_URL`     | your deployed origin, no trailing slash           |
   | `CRON_SECRET` | the same value as the Vercel environment variable |

   On a paid Vercel plan you can use Vercel Cron instead by putting the job back
   in `vercel.json` and deleting the workflow:

   ```json
   {
     "crons": [
       { "path": "/api/cron/activity", "schedule": "*/15 * * * *" },
       { "path": "/api/cron/standups", "schedule": "*/10 * * * *" }
     ]
   }
   ```

   Vercel attaches `Authorization: Bearer $CRON_SECRET` automatically when a
   `CRON_SECRET` environment variable exists on the project.
6. Set the callback/redirect URLs: GitHub
   `https://<your-domain>/api/auth/github/callback`, Google
   `https://<your-domain>/api/auth/callback/google`, Slack
   `https://<your-domain>/api/integrations/slack/callback`.
7. Sign in once, then run `npm run admin:grant -- <your email>` against the
   production database to create the first administrator.

Hobby-plan note: Vercel Cron runs at most once per day on the Hobby tier and
caps function duration at 60 seconds. That is why the shipped scheduler is the
GitHub Actions workflow above rather than a Vercel cron entry.

## Testing

```bash
npm test
```

243 tests. Standup automations and platform:

- duplicate-execution protection — concurrent runs, re-runs, crash-after-post
  resume, stored-AI-output reuse, shared daily parent across automations
  (`tests/duplicate-execution.test.ts`, engine against in-memory fakes),
- authentication: sign-in policy, first-login role, hashed sessions, disabled
  users, provider tokens not stored (`tests/auth.test.ts`),
- RBAC and IDOR (`tests/rbac.test.ts`), two users cannot access each other's
  automations or executions (`tests/automation-ownership.test.ts`), admin
  authorization and no-token queries (`tests/admin-authorization.test.ts`),
- GitHub commit filtering by author, local-day window, merges and cross-branch
  dedupe (`tests/commit-filter.test.ts`),
- timezone/DST schedule math and scheduler selection, budgets and retry policy
  (`tests/automation-schedule.test.ts`, `tests/scheduler.test.ts`),
- AI output validation and prompt construction (`tests/ai-validation.test.ts`),
- Slack message escaping, thread detection, error mapping and request
  signatures (`tests/slack.test.ts`),
- token encryption (including the legacy key), log redaction and audit
  metadata sanitisation (`tests/secrets-hygiene.test.ts`).

Commit activity:

- timezone conversion and DST correctness (`tests/timezone.test.ts`),
- commit slot derivation, next-run and due-run calculation
  (`tests/next-run.test.ts`),
- schedule, commit-message and activity-path validation (`tests/validation.test.ts`),
- activity-file transitions (`tests/activity-file.test.ts`),
- cron authentication and batch isolation (`tests/cron-auth.test.ts`),
- duplicate-execution prevention and run outcomes (`tests/run-activity.test.ts`),
- ownership/IDOR enforcement (`tests/authorization.test.ts`),
- GitHub API error mapping for 401/403/404/409/422/429 and rate limits
  (`tests/github-errors.test.ts`),
- encryption round-trip, tamper detection and constant-time compare
  (`tests/encryption.test.ts`),
- rate limiting (`tests/rate-limit.test.ts`).

No test performs a real GitHub, Slack, NVIDIA or database call.

What the tests cannot prove is the live integration: end-to-end runs against
real Google, GitHub, Slack and NVIDIA accounts need real credentials. Verify a
deployment by signing in, connecting GitHub and Slack, creating an automation,
using **Test Automation** (dry run), then **Run now**, and checking the
execution detail page and the Slack thread.

## Security considerations

**Token handling.** GitHub and Slack tokens are encrypted with AES-256-GCM
(random 12-byte IV per record, authenticated) before storage and decrypted only
inside the provider clients on the server. Google tokens are not stored. Tokens
never appear in API responses, logs, error messages, URLs, audit metadata, or
browser storage; the structured logger additionally redacts credential-shaped
keys and known token formats. Admin views select integration status only.

**Sessions.** Auth.js database sessions: a random token in an httpOnly,
`SameSite=Lax`, `__Secure-` (HTTPS) cookie; only its SHA-256 hash is stored.
Disabling a user deletes all their sessions, and the session adapter refuses
disabled users. Expired sessions are pruned on each cron run.

**CSRF.** Auth.js enforces its CSRF token on sign-in/sign-out. Integration OAuth
flows use a single-use `state` bound to the signed-in user and compared in
constant time. Every cookie-authenticated mutation (`POST`/`PATCH`/`DELETE`)
must carry an `Origin` (or `Referer`) matching `NEXT_PUBLIC_APP_URL`, on top of
SameSite cookies.

**AI output.** Model output is untrusted: it must parse as JSON, pass a strict
Zod schema (shape, length, no Slack mention/link syntax, no meaningless or
duplicate bullets, no more bullets than commits), and is then HTML-escaped for
Slack and placed into an application-built template. Commit messages and the
user's note are passed to the model as delimited data with an instruction to
ignore instructions inside them.

**Webhooks.** `/api/webhooks/slack/events` verifies the Slack v0 HMAC signature
over the raw body and rejects requests older than five minutes.

**Authorization / IDOR.** Every route resolves the user from the session and
scopes each query by `userId`. A schedule or repository belonging to someone else
returns `404`, never `403`, so ids cannot be probed. Client-supplied ids are
never trusted as ownership proof.

**Input validation.** Zod validates every request body and query string on the
server. Client-side validation is a convenience only. Commit messages are
restricted to one control-character-free line, and the activity path must be a
relative `.json` path with no `..` traversal.

**Rate limiting.** `lib/rate-limit.ts` protects repository refresh, schedule
create/update/delete, manual runs (5 per 5 minutes), settings and auth start.
Redis-backed when Upstash credentials are present; otherwise an in-memory
limiter suitable for a single development instance.

**Environment handling.** `lib/env.ts` parses the environment through Zod and
lists only the *names* of invalid keys in its error. Server-only modules import
`server-only`, so a stray client import is a build error rather than a leak.

**Response headers.** `next.config.ts` sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, a strict `Referrer-Policy`, and a restrictive
`Permissions-Policy`.

**Known advisory.** `npm audit` reports a high-severity advisory in
`deepmerge-ts`, reached only through `@prisma/config` — a Prisma **CLI**
dependency used at build/migration time. It is not part of the deployed runtime.

## Contribution rules disclaimer

GreenGrid creates real repository commits through GitHub's APIs. GitHub
independently determines which commits appear on your contribution graph based
on its contribution rules — which typically require, among other things, that
the commit is on the default branch (or a `gh-pages` branch), that the commit
email matches a verified address on your account, and that you are an owner or
collaborator of the repository.

GreenGrid does **not** guarantee that any commit will appear as a contribution.
Use it on repositories where automated maintenance commits are genuinely
appropriate, and in accordance with GitHub's Terms of Service and Acceptable Use
Policies.
