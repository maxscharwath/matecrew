# MateCrew

Mate consumption tracking web app for offices. Track daily requests, manage stock, handle purchases and reimbursements, with Slack integration.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Auth**: Better Auth 1.5 (email/password + Microsoft Entra ID SSO)
- **Database**: PostgreSQL (Docker local / Neon production) + Prisma 7
- **UI**: Tailwind CSS 4 + shadcn/ui + Recharts
- **Storage**: Cloudflare R2 in production, MinIO in dev (S3-compatible)
- **Notifications**: Slack Incoming Webhooks
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

# Push schema to database
bunx prisma db push

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

MinIO provides S3-compatible storage for invoice uploads during development. The `minio-init` container automatically creates the `matecrew-invoices` bucket.

## Environment Variables

Copy `.env.local` or create your own. All variables:

### Core

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://matecrew:matecrew@localhost:5432/matecrew` |
| `DIRECT_URL` | Direct Postgres connection (migrations) | Same as DATABASE_URL |
| `BETTER_AUTH_SECRET` | Auth secret (`openssl rand -base64 32`) | Required |
| `BETTER_AUTH_URL` | App URL | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Public app URL | `http://localhost:3000` |

### Email Domain Restriction

| Variable | Description | Default |
|---|---|---|
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated list of allowed email domains. Empty = allow all. | (empty) |

Example: `ALLOWED_EMAIL_DOMAINS=owt.swiss,openwt.com` blocks sign-up from any other domain. Applies to both email/password and Microsoft SSO.

### Object Storage

In development, MinIO is used automatically. For production, configure Cloudflare R2:

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

### Cron

| Variable | Description | Default |
|---|---|---|
| `CRON_SECRET` | Bearer token for cron endpoint authentication | `local-dev-cron-secret` |

## Project Structure

```
src/
  app/
    (auth)/                          # Sign-in, sign-up pages
    org/[officeId]/
      dashboard/                     # User dashboard (consumption, costs)
      request/                       # Daily mate request
      runner/                        # Runner view (mark served)
      admin/
        settings/                    # Office config (Slack, timezone, etc.)
        stock/                       # Stock management + audit log
        purchases/                   # Purchase batches + invoice upload
        reimbursements/              # Period-based reimbursement calc
    api/
      auth/[...all]/                 # Better Auth API handler
      cron/daily-request/            # Vercel Cron endpoint
  components/
    ui/                              # shadcn/ui components
    app-sidebar.tsx                  # Main navigation sidebar
    purchase-form.tsx                # Purchase entry form
    purchase-list.tsx                # Purchase history table
    stock-card.tsx                   # Stock adjustment card
    reimbursement-period-card.tsx    # Period calculation display
    ...
  lib/
    auth.ts                          # Better Auth server config
    auth-client.ts                   # Better Auth client hooks
    auth-utils.ts                    # requireSession, requireOrgRoles helpers
    prisma.ts                        # Prisma client singleton
    r2.ts                            # S3 client (MinIO dev / R2 prod)
    r2-helpers.ts                    # Upload, download, delete helpers
    slack.ts                         # Slack webhook helper
    stock-alerts.ts                  # Low stock Slack alerts
    reimbursement-calc.ts            # Cost sharing + settlement algorithm
    csv-export.ts                    # Reimbursement CSV export
  proxy.ts                           # Route protection (Next.js 16 proxy)
prisma/
  schema.prisma                      # Database schema
  seed.ts                            # Development seed data
```

## Features

### For Employees
- **Daily requests**: Declare "I want a mate" each day via link from Slack or app
- **Dashboard**: Personal consumption history, monthly cost share, net balance
- **Multi-office**: Switch between offices if you belong to multiple

### For Runners
- **Runner view**: See today's requests, mark each as served
- **Stock auto-decrement**: Stock decreases automatically when marking served

### For Admins
- **Office settings**: Configure Slack webhook, posting time, timezone, low stock threshold
- **Stock management**: Adjust stock manually, view 30-day chart and audit trail
- **Purchases**: Record bulk purchases (ORDERED -> DELIVERED workflow), upload invoices
- **Reimbursements**: Create periods, calculate who owes whom, export CSV
- **Low stock alerts**: Automatic Slack alert when stock drops below threshold (24h cooldown)

### Authentication
- Email/password sign-up and sign-in
- Microsoft Entra ID (Azure AD) SSO
- Configurable email domain restriction
- Account linking: SSO users auto-link to existing accounts by email

## Roles

Roles are per-office (via Membership):

| Role | Permissions |
|---|---|
| **EMPLOYEE** | Request mate, view dashboard |
| **RUNNER** | All employee + mark requests as served |
| **ADMIN** | All runner + manage stock, purchases, reimbursements, settings |

## Slack Integration

Each office can have a Slack webhook configured. Used for:

1. **Daily request message**: Posted at the configured time via Vercel Cron, with a button linking to the request page
2. **Low stock alert**: Sent when stock drops below the configured threshold (once per 24h)
3. **Test message**: Sendable from admin settings to verify webhook works

### Cron Setup

**Local dev**: Trigger manually:
```bash
curl -H "Authorization: Bearer local-dev-cron-secret" http://localhost:3000/api/cron/daily-request
```

**Vercel**: Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/daily-request",
      "schedule": "0 8 * * 1-5"
    }
  ]
}
```

## Deployment

Deploy to [Vercel](https://vercel.com):

```bash
bunx vercel
```

Required env vars for production:
- `DATABASE_URL` / `DIRECT_URL` (Neon or other hosted Postgres)
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`
- `CRON_SECRET`
- Optionally: `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID`
- Optionally: `ALLOWED_EMAIL_DOMAINS`
