#!/usr/bin/env bash
# Sobe o app já compilado com um banco de demonstração novo, numa pasta temporária.
set -euo pipefail
DIR=$(mktemp -d -t fyminance-e2e-XXXXXX)
pnpm --silent fy demo --dir "$DIR" >/dev/null
export FYMINANCE_DATA_DIR="$DIR"
# Ignora a configuração de quem roda o teste: só valem os dados de exemplo.
export FYMINANCE_CONFIG_FILE="$DIR/config.env"
exec node node_modules/next/dist/bin/next start -p 3322
