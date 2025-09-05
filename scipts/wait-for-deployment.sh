#!/usr/bin/env bash
set -euo pipefail
NS=$1
DEPLOY=$2
TIMEOUT=${3:-180s}
kubectl -n "$NS" rollout status "deploy/$DEPLOY" --timeout="$TIMEOUT"
