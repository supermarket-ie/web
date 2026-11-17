#!/usr/bin/env bash
# Runs scripts/diagnostics/direct-capture-diagnostic.mjs ONCE as a one-off ECS task on the existing
# smie-prod-scheduled task definition (current worker image, task role, AWS egress, request governor).
# No new image, task definition or infrastructure. Usage: run-direct-capture-diagnostic.sh [--dry]
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-smie-prod}" AWS_REGION="${AWS_REGION:-eu-west-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
B64="$(gzip -9c "$HERE/direct-capture-diagnostic.mjs" | base64 | tr -d '\n')"
CMD="echo $B64 | base64 -d | gunzip > /tmp/d.mjs && DIAG_DRY=$DRY node --conditions=react-server --import tsx /tmp/d.mjs"
NET='awsvpcConfiguration={subnets=[subnet-0ff02da22ebe91794,subnet-07c3dc58ad255b5bc],securityGroups=[sg-0f382e9d266cbb4dc],assignPublicIp=ENABLED}'
OVR="$(node -e 'console.log(JSON.stringify({containerOverrides:[{name:"scheduled",command:["sh","-c",process.argv[1]]}]}))' "$CMD")"
aws ecs run-task --cluster smie-prod-cluster --launch-type FARGATE --task-definition smie-prod-scheduled \
  --network-configuration "$NET" --overrides "$OVR" --started-by direct-capture-diagnostic \
  --query 'tasks[0].taskArn' --output text
