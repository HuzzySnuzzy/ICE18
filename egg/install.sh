#!/bin/bash
# ICE18 panel install script.
# Pterodactyl runs this in a temporary container with the server's folder mounted at /mnt/server.
# It only touches the ICE18 panel's own server folder. Your .env file (if any) is kept.
set -euo pipefail

REPO="${GIT_REPO:-https://github.com/HuzzySnuzzy/ice18}"
BRANCH="${GIT_BRANCH:-main}"

apt-get update -qq
apt-get install -y -qq git ca-certificates > /dev/null

cd /mnt/server
git config --global --add safe.directory /mnt/server

if [ -d .git ]; then
  echo "Updating ICE18 from ${REPO} (${BRANCH})"
  git fetch --depth 1 origin "${BRANCH}"
  git reset --hard "origin/${BRANCH}"
else
  echo "Downloading ICE18 from ${REPO} (${BRANCH})"
  rm -rf /tmp/ice18
  git clone --depth 1 --branch "${BRANCH}" "${REPO}" /tmp/ice18
  cp -a /tmp/ice18/. /mnt/server/
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
# Copy packages into node_modules: the pnpm store in this temporary container is thrown away.
pnpm install --frozen-lockfile --config.package-import-method=copy
pnpm build

echo "ICE18 installed. Start the server to launch the panel."
