# MateCrew

Mate consumption tracking web app for offices. Track daily requests, manage stock, handle purchases and reimbursements, with Slack integration and scheduled mate sessions.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Auth**: Better Auth 1.5 (email/password + Microsoft Entra ID SSO)
- **Database**: PostgreSQL (Docker local / Neon production) + Prisma 7
- **UI**: Tailwind CSS 4 + shadcn/ui + Recharts
- **Storage**: Vercel Blob (default) or Cloudflare R2 (configurable via `STORAGE_PROVIDER`)
- **Notifications**: Slack Bot API (chat.postMessage) + Upstash QStash (scheduled cron)
- **PDF**: @react-pdf/renderer for settlement exports
- **i18n**: next-intl (French / English)
- **Runtime**: Bun

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- [Docker](https://docs.docker.com/get-docker/) installed (for local Postgres + MinIO)

### Setup

```bash
# Clone the repo
git clone https://github.com/<your-org>/matecrew.git
cd matecrew

# Start local services (Postgres + MinIO)
docker compose up -d

# Install dependencies
bun install
bun pm trust prisma @prisma/engines

# Generate Prisma client
bunx prisma generate

# Run migrations
bunx prisma migrate dev

# Seed initial data (offices, users, sample requests)
bun run seed

# Start dev server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Test Accounts (from seed)

| Email | Password | Role | Offices |
|---|---|---|---|
| `admin@matecrew.local` | `admin123` | Admin | Lausanne + Geneve |
| `marie@matecrew.local` | `runner123` | Runner | Lausanne |
| `alice@matecrew.local` | `employee123` | Employee | Lausanne |
| `bob@matecrew.local` | `employee123` | Employee | Lausanne |
| `claire@matecrew.local` | `employee123` | Employee | Geneve |

### Local Services

| Service | URL | Credentials |
|---|---|---|
| App | http://localhost:3000 | See test accounts above |
| MinIO Console | http://localhost:9001 | `minioadmin` / `minioadmin` |
| PostgreSQL | localhost:5432 | `matecrew` / `matecrew` |

MinIO provides S3-compatible storage for invoice/avatar uploads during development. The `minio-init` container automatically creates the `matecrew-invoices` bucket.

## Environment Variables

Copy `.env.local` or create your own. All variables:

### Core

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://matecrew:matecrew@localhost:5432/matecrew` |
| `DIRECT_URL` | Direct Postgres connection (migrations) | Same as DATABASE_URL |
| `BETTER_AUTH_SECRET` | Auth secret (`openssl rand -base64 32`) | Required |
| `BETTER_AUTH_URL` | App URL. Also published as the OAuth `issuer` for the [MCP connector](#mcp-server-claude-connector), so it must match the public origin exactly. | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Public app URL | `http://localhost:3000` |

### Email Domain Restriction

| Variable | Description | Default |
|---|---|---|
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated list of allowed email domains. Empty = allow all. | (empty) |

Example: `ALLOWED_EMAIL_DOMAINS=owt.swiss,openwt.com` blocks sign-up from any other domain. Applies to both email/password and Microsoft SSO.

### Object Storage

Storage provider is selected via `STORAGE_PROVIDER` (default: `vercel-blob`).

**Vercel Blob** (default for production):

| Variable | Description |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write token |

**Cloudflare R2** (alternative):

| Variable | Description | Default |
|---|---|---|
| `S3_ENDPOINT` | S3 endpoint (dev) | `http://localhost:9000` |
| `S3_ACCESS_KEY` | S3 access key (dev) | `minioadmin` |
| `S3_SECRET_KEY` | S3 secret key (dev) | `minioadmin` |
| `R2_BUCKET_NAME` | Bucket name | `matecrew-invoices` |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID (prod) | |
| `R2_ACCESS_KEY_ID` | R2 access key (prod) | |
| `R2_SECRET_ACCESS_KEY` | R2 secret key (prod) | |

### Microsoft SSO (Optional)

| Variable | Description | Default |
|---|---|---|
| `MICROSOFT_CLIENT_ID` | Azure Entra ID app client ID | |
| `MICROSOFT_CLIENT_SECRET` | Azure Entra ID app client secret | |
| `MICROSOFT_TENANT_ID` | Azure tenant ID (`common` for multi-tenant) | `common` |

To enable, register an app in [Azure Entra ID](https://entra.microsoft.com):
1. New registration > Web > Redirect URI: `{APP_URL}/api/auth/callback/microsoft`
2. Certificates & secrets > New client secret
3. Copy Client ID + Secret into env vars

### Slack Bot

| Variable | Description | Default |
|---|---|---|
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) | Required |
| `SLACK_SIGNING_SECRET` | Signing Secret (Basic Information → App Credentials) — verifies interactive button clicks | Required |
| `SLACK_BOT_USERNAME` | Override bot display name in messages | `MateCrew` |
| `SLACK_BOT_ICON_URL` | Override bot avatar URL in messages | |

To set up:
1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Go to **OAuth & Permissions**, add bot scopes: `chat:write`, `users:read`, `users:read.email`
3. Install to workspace, copy the Bot User OAuth Token (`xoxb-...`)
4. Go to **Interactivity & Shortcuts**, enable it, set **Request URL** to `https://YOUR_DOMAIN/api/slack/interactions` (required for the in-message "I want a maté" / "Cancel" buttons)
5. Copy the **Signing Secret** from **Basic Information → App Credentials** into `SLACK_SIGNING_SECRET`
6. Invite the bot to each office's Slack channel
7. In admin settings, enter each channel's ID (right-click channel > "Copy channel ID")

### Cron / QStash

| Variable | Description | Default |
|---|---|---|
| `CRON_SECRET` | Bearer token for cron endpoint authentication | `local-dev-cron-secret` |
| `QSTASH_TOKEN` | Upstash QStash token (production scheduled cron) | |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash signature verification key | |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key | |

## Project Structure

```
src/
  app/
    (auth)/                          # Sign-in, sign-up pages
    profile/                         # User profile (name, locale, avatar)
    org/create/                      # Create a new office
    org/[officeId]/
      join/                          # Join request flow for new members
      dashboard/                     # User dashboard (consumption, costs)
      request/                       # Daily mate request
      runner/                        # Runner view (mark served)
      reimbursements/                # User reimbursement view
      admin/
        members/                     # Member management + join requests
        settings/                    # Office config (Slack, timezone, etc.)
        schedule/                    # Mate session schedule editor
        stock/                       # Stock management + audit log
        purchases/                   # Purchase batches + invoice upload
        reimbursements/              # Period-based reimbursement calc + PDF
        cron/                        # Manual cron trigger (dev)
    oauth/consent/                   # OAuth consent screen for MCP clients
    .well-known/                     # OAuth AS + protected-resource metadata
    api/
      auth/[...all]/                 # Better Auth API handler (incl. MCP OAuth)
      mcp/                           # MCP endpoint — the Claude connector URL
      cron/daily-request/            # Daily mate request notification
      cron/monthly-reimbursement/    # Monthly auto-reimbursement generation
  components/
    ui/                              # shadcn/ui components
    app-sidebar.tsx                  # Main navigation sidebar
    sidebar-shell.tsx                # Sidebar layout wrapper
    nav-breadcrumb.tsx               # Dynamic breadcrumb navigation
    request-view.tsx                 # Daily request UI
    runner-view.tsx                  # Runner serving UI
    take-can-button.tsx              # Quick "take a can" button
    schedule-editor.tsx              # Mate session schedule CRUD
    purchase-form.tsx                # Purchase entry form
    purchase-list.tsx                # Purchase history table
    stock-card.tsx                   # Stock adjustment card
    stock-chart.tsx                  # Stock history chart
    reimbursement-period-card.tsx    # Period calculation display
    user-reimbursement-card.tsx      # User-facing reimbursement card
    members-table.tsx                # Office member management
    add-member-form.tsx              # Add member to office
    join-request-screen.tsx          # Join request UI
    pending-requests-card.tsx        # Pending join requests for admin
    consumption-history-card.tsx     # Consumption history display
    today-consumptions-card.tsx      # Today's consumptions summary
    profile-form.tsx                 # User profile editor
    office-settings-form.tsx         # Office settings form
    create-office-form.tsx           # New office creation form
    timezone-combobox.tsx            # Timezone picker
    pagination.tsx                   # Generic pagination component
    ...
  lib/
    auth.ts                          # Better Auth server config
    auth-client.ts                   # Better Auth client hooks
    auth-utils.ts                    # requireSession, requireRoles helpers
    prisma.ts                        # Prisma client singleton
    base-url.ts                      # Public origin / OAuth issuer resolution
    mcp/
      server.ts                      # Tool registration + model instructions
      context.ts                     # Actor, office scoping, per-office roles
      tool.ts                        # defineTool: auth, JSON encoding, errors
      tools/                         # One module per domain area
    storage/                         # Pluggable storage (Vercel Blob / R2)
    slack.ts                         # Slack Bot API messaging
    stock-alerts.ts                  # Low stock Slack alerts
    reimbursement-calc.ts            # Cost sharing + settlement algorithm
    pdf-export.tsx                   # React-PDF settlement export
    csv-export.ts                    # Reimbursement CSV export
    qstash.ts                        # QStash client for scheduled jobs
    notifications.ts                 # Notification helpers
    session-utils.ts                 # Mate session time utilities
    date.ts                          # Date/timezone helpers
    ids.ts                           # Branded Zod ID types
    sidebar-data.ts                  # Sidebar navigation config
    locale.ts                        # i18n locale helpers
    oauth-providers.ts               # OAuth provider config
    utils.ts                         # General utilities
  hooks/                             # React hooks
  proxy.ts                           # Route protection (Next.js 16 proxy)
  i18n/                              # next-intl config
messages/
  en.json                            # English translations
  fr.json                            # French translations
prisma/
  schema.prisma                      # Database schema
  seed.ts                            # Development seed data
  migrations/                        # Prisma migrations
```

## Features

### For Employees
- **Daily requests**: Declare "I want a mate" each day via link from Slack or app
- **Mate sessions**: Multiple sessions per day (e.g. morning/afternoon) with configurable schedules
- **Dashboard**: Personal consumption history, monthly cost share, net balance
- **Quick take**: "Take a can" button for ad-hoc consumption outside scheduled sessions
- **Join requests**: Request to join an office, admins approve/reject
- **Multi-office**: Switch between offices if you belong to multiple
- **Profile**: Manage name, avatar, locale preference
- **i18n**: Full French and English support

### For Admins
- **Member management**: Approve/reject join requests, add members, manage roles
- **Office settings**: Configure Slack channel ID, timezone, locale, low stock threshold
- **Schedule editor**: Configure mate sessions per day of week with start/cutoff times
- **Stock management**: Adjust stock manually, view 30-day chart and audit trail
- **Purchases**: Record bulk purchases (ORDERED -> DELIVERED workflow), upload invoices
- **Reimbursements**: Create periods, calculate who owes whom, export PDF/CSV
- **Low stock alerts**: Automatic Slack alert when stock drops below threshold (24h cooldown)
- **Cron management**: View and manually trigger cron jobs (dev)

### Authentication
- Email/password sign-up and sign-in
- Microsoft Entra ID (Azure AD) SSO
- Configurable email domain restriction
- Account linking: SSO users auto-link to existing accounts by email

## Reimbursement Model

Purchases are **bulk orders** (e.g. 300 cans every few months), not monthly. All cans go into a shared pool. The settlement algorithm splits costs fairly across consumers and credits payers proportionally.

### Definitions

| Symbol | Meaning |
|--------|---------|
| S | Total spend across **all** purchases for the office |
| Q | Total quantity purchased |
| u = S / Q | Weighted-average unit price |
| spend_k | Total amount payer *k* has spent |
| C_j | Cans consumed in period *j* |

### Per-period calculation

1. **Unit price** -- weighted average across every purchase ever recorded for the office:

   ```
   u = S / Q
   ```

2. **Period cost** -- cans consumed in the period times unit price:

   ```
   periodCost_j = C_j x u
   ```

3. **Consumer share** -- each user pays for what they drank:

   ```
   costShare_i = qty_i x u
   ```

4. **Payer credit** -- each payer is credited proportionally to their share of total spend:

   ```
   credit_k = (spend_k / S) x periodCost_j
   ```

5. **Net owed** -- positive means the user owes money, negative means they are owed:

   ```
   netOwed_i = costShare_i - credit_i
   ```

6. **Payment lines** -- a greedy algorithm matches debtors to creditors to minimise the number of transfers.

### Zero-loss guarantee

Using **all** purchases globally (not scoped to the period date range) guarantees no money is ever lost:

```
credit_k  = (spend_k / S) x C_j x (S / Q)
          = spend_k x C_j / Q
```

Summing over all periods until every purchased can is consumed (C = Q):

```
total_credit_k = spend_k x Q / Q = spend_k
```

Every payer gets back exactly what they spent. Payment line amounts are frozen in the database when a period is generated, so later purchases shifting the unit price do not affect already-settled periods.

## Roles

Roles are per-office (via Membership):

| Role | Permissions |
|---|---|
| **USER** | Request mate, view dashboard, view reimbursements |
| **ADMIN** | All user permissions + manage members, stock, purchases, reimbursements, settings, schedule |

## Slack Integration

Each office can have a Slack channel ID configured. Messages are sent via a shared Slack Bot App using `chat.postMessage`. Used for:

1. **Session request message**: Posted at each session start via QStash/Cron. Users click **I want a maté** or **Cancel** directly in Slack — the handler at `/api/slack/interactions` registers the request (no browser redirect) and updates the message in place with the running list of registered users. First-time clickers whose Slack email matches a MateCrew user are auto-linked; others get an ephemeral "Connect" button that opens a signed one-time URL to `/slack/link` for an authenticated confirmation.
2. **Low stock alert**: Sent when stock drops below the configured threshold (once per 24h)
3. **Test message**: Sendable from admin settings to verify integration works

## MCP Server (Claude connector)

MateCrew exposes its whole feature set to Claude Desktop, claude.ai and any other
MCP client at:

```
https://YOUR_DOMAIN/api/mcp
```

Add it as a **custom connector** and paste that URL — nothing to provision by
hand. The client registers itself (RFC 7591 dynamic client registration), opens
the MateCrew sign-in page in a browser, and receives a token scoped to that user.

### What Claude can do

Tools act as the signed-in user with exactly their own authority, so a member can
order and see stats, and an admin can additionally manage their offices. Roles are
resolved **per office** on every call, from `Membership.roles` — the same source
the web UI uses. `matecrew_admin_*` tools refuse callers who are not ADMIN of the
office being acted on.

| Area | Tools |
|---|---|
| Identity | `whoami`, `get_office`, `set_default_office`, `set_locale`, `request_office_access` |
| Ordering | `get_today`, `order_mate`, `cancel_order`, `take_a_can`, `list_items`, `get_schedule` |
| Serving a round | `list_pending_orders`, `serve_session`, `serve_order`, `unserve_order`, `drop_order` |
| Personal data | `my_consumption`, `cancel_consumption`, `stats`, `my_reimbursements`, `settle_payment` |
| Admin — stock | `admin_stock_report` (incl. reorder forecast), `admin_adjust_stock` |
| Admin — catalogue | `admin_create_item`, `admin_update_item` |
| Admin — money | `admin_list_purchases`, `admin_create_purchase`, `admin_mark_delivered`, `admin_list_periods`, `admin_preview_reimbursements`, `admin_generate_periods`, `admin_sync_period`, `admin_unsettle_payment`, `admin_delete_period` |
| Admin — people | `admin_list_members`, `admin_add_member`, `admin_set_member_roles`, `admin_remove_member`, `admin_review_join_request` |
| Admin — config | `admin_update_office`, `admin_test_slack`, `admin_announce_session`, `admin_add_session`, `admin_update_session`, `admin_remove_session`, `admin_record_consumption`, `admin_cancel_consumption`, `admin_consumption_report` |

Every tool takes an optional `office` (id **or** name) and falls back to the
user's default office, or their only one. Items and people can be named rather
than referenced by id.

Not exposed over MCP: uploading invoice files and item images, and creating or
deleting an office — those stay in the web app.

### How a user signs in

The flow crosses two sites, which is where people usually get stuck — Claude's
"Add" dialog is not the end of it:

1. **Profile → Connect to Claude → Add to Claude.** Opens claude.ai with the
   MateCrew URL prefilled (Claude never lets a link add a connector silently).
2. **Confirm in Claude.** Claude reads
   `/.well-known/oauth-protected-resource/api/mcp`, follows it to MateCrew's
   authorization server metadata, and registers itself as a client.
3. **Sign in to MateCrew.** Claude sends the user to `/api/auth/mcp/authorize`.
   With no session they land on `/sign-in`; the pending request is parked in a
   signed cookie and resumes automatically after sign-in.
4. **Approve.** Claude receives an authorization code, exchanges it for an
   access + refresh token, and calls `/api/mcp` with `Authorization: Bearer …`.

The token is minted for **one MateCrew user**, so every tool call carries exactly
that person's authority. Access lasts an hour and is refreshed silently for a
week of inactivity. Revoke it under **Profile → Connect to Claude → Connected
apps**, which drops that user's tokens only — colleagues using the same Claude
installation are unaffected.

In Claude Code the same thing happens without a browser dialog:
`claude mcp add …`, then `/mcp` → Authenticate opens the sign-in page.

### How the auth works

MateCrew is its own OAuth 2.1 authorization server, via Better Auth's `mcp`
plugin. Authorization code + PKCE (S256 only), with refresh tokens.

| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-authorization-server` | AS metadata (RFC 8414); `issuer` is the bare origin |
| `/.well-known/oauth-protected-resource/api/mcp` | Resource metadata (RFC 9728) |
| `/api/auth/mcp/register` | Dynamic client registration |
| `/api/auth/mcp/authorize` · `/token` | Authorization + token exchange |
| `/oauth/consent` | Consent screen (shown when a client sends `prompt=consent`) |

`BETTER_AUTH_URL` (or `NEXT_PUBLIC_APP_URL`) **must** be set to the public origin
— it is published verbatim as the OAuth `issuer`, and clients reject a mismatch.

Expired tokens are swept weekly by the `sync-schedules` cron.

**`/api/mcp` must send CORS headers**, including
`Access-Control-Expose-Headers: WWW-Authenticate`. `mcp-handler` applies CORS to
its metadata handlers but not to the MCP endpoint, and without it the Claude web
app is blocked in the browser while Claude Code — which connects server-side —
works fine. If the challenge header is not *exposed*, a browser client cannot
read the 401 and so never discovers where to sign in; the connector then fails
looking like an unreachable server. `src/app/api/mcp/route.ts` wraps the handler
to add these.

Two other things the `mcp` plugin gets wrong, corrected in
`src/app/.well-known/oauth-authorization-server/[[...path]]/route.ts`: it
advertises `jwks_uri` and `userinfo_endpoint` without registering either route,
and claims `RS256` id_tokens when they are in fact HS256. (`oidcConfig.metadata`
looks like the place to fix this but is never read — the plugin passes its outer
options to the metadata builder.)

### Cron Setup

**Local dev**: Trigger manually from the admin cron page or via curl:
```bash
curl -H "Authorization: Bearer local-dev-cron-secret" http://localhost:3000/api/cron/daily-request
```

**Production**: Uses Upstash QStash for scheduled execution. Run the setup script:
```bash
bun run setup:qstash
```

## Deployment

Deploy to [Vercel](https://vercel.com):

```bash
bunx vercel
```

The `vercel-build` script runs `prisma generate && prisma migrate deploy && next build` automatically.

Required env vars for production:
- `DATABASE_URL` / `DIRECT_URL` (Neon or other hosted Postgres)
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob) or R2 credentials
- `CRON_SECRET`
- `QSTASH_TOKEN` / `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`
- `SLACK_BOT_TOKEN`
- Optionally: `SLACK_BOT_USERNAME` / `SLACK_BOT_ICON_URL`
- Optionally: `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID`
- Optionally: `ALLOWED_EMAIL_DOMAINS`
