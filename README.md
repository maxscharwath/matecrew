# MateCrew

Maté consumption tracking web app for offices. Track daily requests, manage stock, handle purchases and reimbursements, with Slack integration.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Auth**: Better Auth (credentials, Microsoft SSO ready)
- **Database**: PostgreSQL (Docker local / Neon production) + Prisma 7
- **UI**: Tailwind CSS 4 + shadcn/ui
- **Storage**: Cloudflare R2 (invoice uploads)
- **Notifications**: Slack Incoming Webhooks
- **Runtime**: Bun

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- [Docker](https://docs.docker.com/get-docker/) installed (for local Postgres)

### Setup

```bash
# Start local Postgres
docker compose up -d

# Install dependencies
bun install

# Copy env file (defaults point to Docker Postgres)
cp .env.example .env.local

# Generate a BETTER_AUTH_SECRET and update .env.local
openssl rand -base64 32

# Generate Prisma client
bunx prisma generate

# Run database migrations
bunx prisma migrate dev --name init

# Seed initial data (admin user + office)
bun run seed

# Start dev server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (Docker local or Neon pooled) |
| `DIRECT_URL` | Direct Postgres connection string (for Prisma migrations) |
| `BETTER_AUTH_SECRET` | Auth secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | App URL (e.g. `http://localhost:3000`) |
| `NEXT_PUBLIC_APP_URL` | Public app URL |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |

## Project Structure

```
src/
  app/
    (auth)/          # Sign-in, sign-up pages
    (app)/           # Authenticated user pages (dashboard, request, runner)
    (admin)/         # Admin pages (offices, stock, purchases, reimbursements)
    api/auth/        # Better Auth API handler
  components/ui/     # shadcn/ui components
  lib/
    auth.ts          # Better Auth server config
    auth-client.ts   # Better Auth client hooks
    prisma.ts        # Prisma client singleton
    r2.ts            # Cloudflare R2 client
    slack.ts         # Slack webhook helper
  proxy.ts           # Route protection (Next.js 16 proxy)
prisma/
  schema.prisma      # Database schema
```

## Features

- **Daily requests**: Employees declare "I want a maté" each day
- **Runner view**: Designated runner sees who requested and marks as served
- **Multi-office**: Supports multiple offices (Lausanne, Geneva, etc.)
- **Stock tracking**: Real-time stock per office with low-stock alerts
- **Purchases**: Record bulk purchases with invoice uploads
- **Reimbursements**: Calculate who owes what per period
- **Slack**: Daily automated messages with request links

## Deployment

Deploy to [Vercel](https://vercel.com):

```bash
bunx vercel
```

Set environment variables in Vercel dashboard. Vercel Cron handles daily Slack messages.
