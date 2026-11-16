#!/usr/bin/env bash
# Executar no diretório raiz do repositório: bash scripts/preparar-firebase-hosting.sh
set -euo pipefail
mkdir -p public
cp index.html public/index.html
cp manifest.webmanifest public/manifest.webmanifest
mkdir -p public/icons public/firebase
cp -R icons/. public/icons/
cp firebase/synapse-config.js firebase/synapse-cloud.js public/firebase/
cat > public/robots.txt <<'ROBOTS'
User-agent: *
Disallow: /
ROBOTS
echo "Arquivos preparados em public/. Confira a configuração antes de publicar."
