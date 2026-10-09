#!/usr/bin/env bash
# Runs the site on the local copy of production (scripts/clone-prod-db.sh),
# reachable from the terminal on the LAN, with Slack, e-mail and QStash off
# and files read from the local copy. It takes the place of a running `bun dev`:
# one local site at a time.
set -euo pipefail
cd "$(dirname "$0")/.."
local_url=$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' | sed -E "s#/[^/?]+(\?|$)#/matecrew_prod\1#")
export DATABASE_URL="$local_url" DIRECT_URL="$local_url"
export SLACK_BOT_TOKEN="" SLACK_SIGNING_SECRET="" RESEND_API_KEY="" QSTASH_TOKEN=""
# Files from the copy in .data/storage; uploads stay there too.
export STORAGE_PROVIDER=local LOCAL_STORAGE_DIR=.data/storage
pkill -f "next dev" 2>/dev/null && sleep 1 || true
exec bun run dev --hostname 0.0.0.0
