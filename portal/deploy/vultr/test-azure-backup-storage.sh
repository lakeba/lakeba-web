#!/usr/bin/env bash
# Checks the Azure storage account for the off-server backups from any machine
# with Docker, before setting it up on the server. Run it yourself so the key
# is typed only here (it is hidden and never saved):
#
#   bash deploy/vultr/test-azure-backup-storage.sh
#
# It lists the container, uploads a small test file, downloads it, compares
# checksums and deletes it. The real backups are untouched.
set -euo pipefail
command -v docker >/dev/null || { echo "Docker is needed."; exit 1; }

read -r -p "Azure storage account name: " AZ_ACCOUNT
read -rs -p "Access key (key1 or key2): " AZ_KEY; echo
read -r -p "Container name [lakeba-backups]: " AZ_CONTAINER
AZ_CONTAINER="${AZ_CONTAINER:-lakeba-backups}"
[[ -n "$AZ_ACCOUNT" && -n "$AZ_KEY" ]] || { echo "The account name and key are needed."; exit 1; }

export RCLONE_CONFIG_AZ_TYPE=azureblob RCLONE_CONFIG_AZ_ACCOUNT="$AZ_ACCOUNT" RCLONE_CONFIG_AZ_KEY="$AZ_KEY"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The key goes to the container as an environment variable, not on the command line.
rc() { docker run --rm -e RCLONE_CONFIG_AZ_TYPE -e RCLONE_CONFIG_AZ_ACCOUNT -e RCLONE_CONFIG_AZ_KEY -v "$work:/w" rclone/rclone:1.75 "$@" 2>&1 | grep -v 'Config file .* not found' || true; }

echo; echo "1. Signing in and listing container ${AZ_CONTAINER}…"
if ! docker run --rm -e RCLONE_CONFIG_AZ_TYPE -e RCLONE_CONFIG_AZ_ACCOUNT -e RCLONE_CONFIG_AZ_KEY rclone/rclone:1.75 lsf "az:$AZ_CONTAINER" --max-depth 1 -q >/dev/null 2>"$work/err"; then
  echo "FAILED: Azure did not accept the key, or the container doesn't exist."; tail -5 "$work/err"; exit 1
fi
echo "   OK"
name="connection-check-$(date -u +%Y%m%d-%H%M%S).bin"
head -c 1048576 /dev/urandom > "$work/up.bin"
echo "2. Uploading a 1 MB test file…"
rc copyto "/w/up.bin" "az:$AZ_CONTAINER/lakeba-test/$name" -q
echo "3. Downloading it again…"
rc copyto "az:$AZ_CONTAINER/lakeba-test/$name" "/w/down.bin" -q
if [[ -f "$work/down.bin" ]] && [[ "$(shasum -a 256 < "$work/up.bin")" == "$(shasum -a 256 < "$work/down.bin")" ]]; then echo "   OK: identical"; else echo "FAILED: the file didn't come back intact."; exit 1; fi
echo "4. Deleting the test file…"
rc deletefile "az:$AZ_CONTAINER/lakeba-test/$name" -q
left="$(rc lsf "az:$AZ_CONTAINER/lakeba-test" -q)"
[[ -z "$left" ]] && echo "   OK" || echo "   Still listed: $left"
echo; echo "Azure storage works for the backups: sign-in, upload, download and delete all OK."
