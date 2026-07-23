#!/usr/bin/env bash
# Script: Sync shared backend modules into each service
# Purpose: Terraform packages each backend/<service>/ folder independently, and
#          the example service uses flat same-directory imports. Shared code
#          therefore cannot live outside a service folder at deploy time.
#          backend/_shared/ is the single source of truth; this script copies it
#          into every service so the modules ship inside each zip.
#          Folders prefixed with _ are ignored by Terraform discovery.
# Usage: ./bin/sync-shared.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" > /dev/null 2>&1 || exit 1; pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." > /dev/null 2>&1 || exit 1; pwd -P)"
SHARED_DIR="$PROJECT_ROOT/backend/_shared"
BACKEND_DIR="$PROJECT_ROOT/backend"

if [ ! -d "$SHARED_DIR" ]; then
    echo "ERROR: $SHARED_DIR not found. Aborting..."
    exit 1
fi

echo "INFO: Syncing shared modules from backend/_shared/"

COUNT=0
for SERVICE_DIR in "$BACKEND_DIR"/*/; do
    SERVICE_NAME="$(basename "$SERVICE_DIR")"

    # Skip underscore-prefixed folders (_examples, _shared) -- not deployed.
    case "$SERVICE_NAME" in
        _*) continue ;;
    esac

    # Only sync into folders Terraform recognises as Python services.
    if [ ! -f "$SERVICE_DIR/function.py" ]; then
        continue
    fi

    cp "$SHARED_DIR"/*.py "$SERVICE_DIR"
    echo "  -> $SERVICE_NAME"
    COUNT=$((COUNT + 1))
done

echo "INFO: Synced shared modules into $COUNT service(s)"