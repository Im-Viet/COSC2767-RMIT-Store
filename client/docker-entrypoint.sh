#!/bin/sh
set -e

: "${API_URL:=http://backend-svc:3000/api}"
: "${HOST:=0.0.0.0}"
: "${PORT:=8080}"

echo "Using API_URL=${API_URL}"
echo "Dev server binding on ${HOST}:${PORT}"

# Write .env for dotenv-webpack to pick up at startup
printf "API_URL=%s\n" "$API_URL" > .env

# Start webpack-dev-server with proper host/port
npm run dev -- --host "${HOST}" --port "${PORT}"
