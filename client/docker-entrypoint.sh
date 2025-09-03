#!/bin/sh
set -e

: "${API_URL:=/api}"          # ⬅️ CHANGED default from http://backend-svc:3000/api to /api
: "${HOST:=0.0.0.0}"
: "${PORT:=8080}"

echo "Using API_URL=${API_URL}"
printf "API_URL=%s\n" "$API_URL" > .env
npm run dev -- --host "${HOST}" --port "${PORT}"
