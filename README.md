# GreenGrid

GreenGrid is a GitHub activity automation dashboard. You connect your GitHub
account, pick a repository you own or have write access to, configure a
schedule, and GreenGrid performs a small, real repository maintenance update on
the days you chose — creating one commit per run through GitHub's official REST
API, attributed to your own GitHub account.

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
- [Local development](#local-development)
- [GitHub OAuth setup](#github-oauth-setup)
- [Required GitHub permissions](#required-github-permissions)
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
| Auth       | Custom GitHub OAuth flow with server-side, DB-backed sessions|
| Scheduling | External cron hitting a `CRON_SECRET`-protected endpoint      |
| Tests      | Vitest (GitHub and database access fully mocked)             |

## Architecture

```
src/
  app/
    page.tsx                     Landing page
    login/                       Sign-in
    privacy/  terms/             Legal pages
    dashboard/
      page.tsx                   Overview: stats + contribution calendar
      activity/                  Execution history with filters + pagination
      schedule/                  Schedule builder
      repositories/              Repository selection
      settings/                  Account, defaults, danger zone
    api/
      auth/github/               OAuth start + callback
      auth/logout | session
      github/user | repositories | activity
      schedules/ | schedules/[id]
      activity/run               Manual "Run activity now"
      cron/activity              Scheduler entry point
      settings                   Defaults + disconnect

  components/
    layout/     sidebar, mobile-nav, header, user-menu
    dashboard/  contribution-calendar, calendar-panel, stats-card,
                upcoming-activity, run-now-button, contribution-disclaimer
    repositories/  repository-card, repository-selector
    schedule/      schedule-form, schedule-card, schedule-manager,
                   day-selector, timezone-selector
    activity/      activity-table, activity-status, activity-filters
    ui/            Radix-based primitives, skeletons, empty states

  lib/
    env.ts            Zod-validated server environment contract
    db.ts             Prisma client (pg driver adapter, dev singleton)
    encryption.ts     AES-256-GCM for tokens, constant-time compare, hashing
    session.ts        Opaque DB-backed sessions + OAuth state cookies
    auth.ts           Server-component auth guard
    api.ts            ApiError, safe error responses, route guards
    rate-limit.ts     Provider-agnostic limiter (Upstash REST or in-memory)
    format.ts         Presentation helpers shared by server and client
    validation/       Zod schemas — the single source of input truth
    schedule/         timezone.ts, timezone-search.ts, next-run.ts
                      (pure, fully unit-tested)
    github/           github-client, -user, -repositories, -content,
                      -commits, oauth, errors, types
    activity/         run-activity.ts, calendar.ts, types.ts
    services/         repositories, schedules, activity-history
```

**Layering rule:** UI components never call GitHub. Routes and server components
call `lib/services/*` or `lib/activity/*`, which call `lib/github/*`, which is
the only place Octokit is constructed.

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
| `npm run db:migrate`| `prisma migrate dev`                        |
| `npm run db:deploy` | `prisma migrate deploy` (production)        |
| `npm run db:studio` | Prisma Studio                               |

> The Prisma client is generated into `src/generated/prisma` (gitignored), so
> run `npx prisma generate` after cloning or after changing the schema.

## GitHub OAuth setup

GreenGrid uses a **GitHub OAuth App** (not a GitHub App). No `GITHUB_APP_*`
variables are needed and none are referenced in the code.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** GreenGrid (or your own name)
   - **Homepage URL:** `http://localhost:3000` for development, your deployed
     origin in production
   - **Authorization callback URL:**
     `http://localhost:3000/api/auth/github/callback`
     (in production: `<NEXT_PUBLIC_APP_URL>/api/auth/github/callback` — it must
     match exactly, including scheme and trailing path)
3. Register the app, then **Generate a new client secret**.
4. Copy the Client ID into `GITHUB_CLIENT_ID` and the secret into
   `GITHUB_CLIENT_SECRET`.

If you deploy to several environments, register one OAuth App per environment —
GitHub matches the callback URL strictly.

### The OAuth flow

1. `GET /api/auth/github` mints a random `state`, stores it in an httpOnly
   cookie, and redirects to GitHub.
2. GitHub redirects back to `/api/auth/github/callback`. The handler
   constant-time compares the returned `state` against the cookie (CSRF
   protection), exchanges the code for an access token server-side, encrypts the
   token, upserts the account and opens a session.
3. The browser only ever receives an opaque session cookie.

## Required GitHub permissions

GreenGrid requests these OAuth scopes:

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
| `User`              | Account root; holds automation defaults                        |
| `GitHubAccount`     | One per user; encrypted token, profile fields, granted scopes  |
| `Session`           | Opaque server-side session (`tokenHash` unique, TTL 14 days)   |
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
| `DATABASE_URL`                |    ✅    | PostgreSQL connection string.                                           |
| `GITHUB_CLIENT_ID`            |    ✅    | OAuth App client ID.                                                    |
| `GITHUB_CLIENT_SECRET`        |    ✅    | OAuth App client secret.                                                |
| `GITHUB_TOKEN_ENCRYPTION_KEY` |    ✅    | Base64 of **32 random bytes**; AES-256-GCM key for tokens at rest.       |
| `CRON_SECRET`                 |    ✅    | Bearer secret required by `/api/cron/activity`.                          |
| `NEXT_PUBLIC_APP_URL`         |    ✅    | Public origin; used to build the OAuth redirect URI.                     |
| `UPSTASH_REDIS_REST_URL`      |    —     | Enables distributed rate limiting when set with the token below.         |
| `UPSTASH_REDIS_REST_TOKEN`    |    —     | Upstash REST token.                                                      |

Generate the secrets:

```bash
# GITHUB_TOKEN_ENCRYPTION_KEY (must decode to exactly 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# CRON_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

`NEXT_PUBLIC_APP_URL` is the only public variable and holds no secret. Rotating
`GITHUB_TOKEN_ENCRYPTION_KEY` invalidates every stored token — users will be
asked to reconnect GitHub.

## Prisma migrations

```bash
npx prisma generate          # regenerate the client after schema changes
npx prisma migrate dev       # create + apply a migration in development
npx prisma migrate deploy    # apply pending migrations in production
```

An initial migration is committed at
`prisma/migrations/20260901000000_init/migration.sql`. On a fresh database,
`npx prisma migrate deploy` is enough to create the full schema.

## Cron configuration

The scheduler is entirely external — GreenGrid never relies on an in-process
`setTimeout` or `setInterval`, so it works on serverless platforms.

**Endpoint:** `POST /api/cron/activity` (`GET` is accepted too, for schedulers
such as Vercel Cron that only issue GETs).

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
          curl -fsS -X POST "$APP_URL/api/cron/activity" \
            -H "Authorization: Bearer $CRON_SECRET"
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
5. `vercel.json` already registers the cron job:

   ```json
   { "crons": [{ "path": "/api/cron/activity", "schedule": "*/15 * * * *" }] }
   ```

   Vercel attaches `Authorization: Bearer $CRON_SECRET` automatically when a
   `CRON_SECRET` environment variable exists on the project.
6. Update your GitHub OAuth App's callback URL to
   `https://<your-domain>/api/auth/github/callback`.

Hobby-plan note: Vercel Cron runs at most once per day on the Hobby tier, which
caps you at one commit per day regardless of `commitsPerDay`. Use an external
scheduler (GitHub Actions, cron-job.org, Upstash QStash) or upgrade to Pro for
anything more frequent.

## Testing

```bash
npm test
```

123 tests cover:

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

No test performs a real GitHub or database call — Octokit and Prisma are mocked.

## Security considerations

**Token handling.** GitHub access tokens are encrypted with AES-256-GCM (random
12-byte IV per record, authenticated) before storage. They are decrypted only
inside `getGitHubClient()` on the server. Tokens never appear in API responses,
logs, error messages, URLs, or browser storage. `toGitHubApiError()` deliberately
discards GitHub's raw message and returns a fixed, user-safe string.

**Sessions.** A session is a 256-bit random token stored in an httpOnly,
`SameSite=Lax`, `Secure`-in-production cookie. Only its SHA-256 hash is stored in
the database. Expired sessions are pruned on each cron run. Logout is `POST`-only
so a cross-site link cannot end a session.

**CSRF.** The OAuth flow binds a random `state` to a short-lived httpOnly cookie
and compares it in constant time. State-changing API routes are `POST`/`PATCH`/
`DELETE` with JSON bodies and same-origin cookies.

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
