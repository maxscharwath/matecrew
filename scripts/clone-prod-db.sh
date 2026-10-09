#!/usr/bin/env bash
# Copies the production database into a local one, "matecrew_prod", and its
# stored files into .data/storage, to run the site against real data.
# Production is only read (pg_dump, list and get). The copy
# cannot reach real people: scripts/prod-copy.ts clears its Slack channels
# and Slack ids, and scripts/dev-prod-copy.sh runs the site without Slack,
# e-mail or QStash. Needs `vercel login` and the Docker Postgres.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=matecrew-postgres-1
COPY=matecrew_prod
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Linking writes a VERCEL_OIDC_TOKEN into .env.local: only when not linked yet.
[ -d .vercel ] || vercel link --yes --project matecrew >/dev/null
vercel env pull "$tmp/prod.env" --environment=production --yes >/dev/null
url=""
for name in DATABASE_URL_UNPOOLED POSTGRES_URL_NON_POOLING DIRECT_URL DATABASE_URL; do
  url=$(sed -n "s/^$name=//p" "$tmp/prod.env" | tr -d '"')
  [ -n "$url" ] && break
done
[ -n "$url" ] || { echo "No database URL in the production environment." >&2; exit 1; }

echo "Dumping production (read only)…"
docker exec "$CONTAINER" pg_dump "$url" --format=custom --no-owner --no-acl > "$tmp/prod.dump"

user=$(docker exec "$CONTAINER" printenv POSTGRES_USER)
echo "Restoring into ${COPY}…"
docker exec "$CONTAINER" dropdb -U "$user" --if-exists "$COPY"
docker exec "$CONTAINER" createdb -U "$user" "$COPY"
docker exec -i "$CONTAINER" pg_restore -U "$user" -d "$COPY" --no-owner --no-acl < "$tmp/prod.dump" \
  || echo "pg_restore reported warnings (the public schema already exists, usually)."

echo "Copying the stored files (read only)…"
rm -rf .data/storage
( set -a; . "$tmp/prod.env"; set +a; LOCAL_STORAGE_DIR=.data/storage bun scripts/clone-prod-storage.ts )

local_url=$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' | sed -E "s#/[^/?]+(\?|$)#/$COPY\1#")
echo "Applying this branch's migrations…"
# prisma.config.ts prefers DIRECT_URL, which .env.local sets to the dev database.
DATABASE_URL="$local_url" DIRECT_URL="$local_url" bunx prisma migrate deploy
DATABASE_URL="$local_url" DIRECT_URL="$local_url" bun scripts/prod-copy.ts
echo "Done. Run the site on the copy with: bash scripts/dev-prod-copy.sh"
