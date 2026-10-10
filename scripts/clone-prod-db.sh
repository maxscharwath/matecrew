#!/usr/bin/env bash
# Copies the production database into a local SQLite file,
# .data/prod-copy.sqlite, and its stored files into .data/storage, to run the
# site against real data on the Node platform. Production is only read
# (wrangler d1 export, list and get). The copy cannot reach real people:
# scripts/prod-copy.ts clears its Slack channels and Slack ids, and
# scripts/dev-prod-copy.sh runs the site without Slack or e-mail.
# Needs `wrangler login`, `vercel login` for the files, and SEED_PASSWORD for
# the local admin.
set -euo pipefail
cd "$(dirname "$0")/.."

COPY=.data/prod-copy.sqlite
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
[ -n "${SEED_PASSWORD:-}" ] || { echo "Set SEED_PASSWORD for the local admin." >&2; exit 1; }

echo "Exporting production D1 (read only)…"
bunx wrangler d1 export matecrew --remote --no-schema --output "$tmp/prod.sql"
mkdir -p .data
bun scripts/db/import-sqlite.ts "$tmp/prod.sql" "$COPY"

# Linking writes a VERCEL_OIDC_TOKEN into .env.local: only when not linked yet.
[ -d .vercel ] || vercel link --yes --project matecrew >/dev/null
vercel env pull "$tmp/prod.env" --environment=production --yes >/dev/null

echo "Copying the stored files (read only)…"
rm -rf .data/storage
( set -a; . "$tmp/prod.env"; set +a; bun scripts/cloudflare/copy-blobs.ts --to-dir .data/storage )

DATABASE_URL="file:$COPY" bun scripts/prod-copy.ts
echo "Done. Run the site on the copy with: bash scripts/dev-prod-copy.sh"
