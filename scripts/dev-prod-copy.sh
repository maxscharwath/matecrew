#!/usr/bin/env bash
# Runs the site on the local copy of production (scripts/clone-prod-db.sh),
# reachable from the terminal on the LAN, with Slack and e-mail off
# and files read from the local copy. It takes the place of a running `bun dev`:
# one local site at a time.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL=file:.data/prod-copy.sqlite
export SLACK_BOT_TOKEN="" SLACK_SIGNING_SECRET="" RESEND_API_KEY=""
# Files from the copy in .data/storage; uploads stay there too.
export LOCAL_STORAGE_DIR=.data/storage
pkill -f "next dev" 2>/dev/null && sleep 1 || true
exec bun run dev --hostname 0.0.0.0
