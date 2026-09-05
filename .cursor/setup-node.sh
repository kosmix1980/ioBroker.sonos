#!/usr/bin/env bash
# Idempotent development bootstrap for the ioBroker.sonos Cloud Agent environment.
#
# The adapter's own runtime only needs Node >= 22.0, but the integration test
# harness (@iobroker/testing) installs js-controller, which depends on
# @iobroker/ws-server-library and requires Node >= 22.19 with engine-strict.
# The Cloud Agent base image's default `node` (/exec-daemon/node) is 22.14, so
# we install a newer Node 22 via the preinstalled nvm and expose it ahead of
# /exec-daemon on PATH so it becomes the default node for every agent shell.
set -euo pipefail

NODE_MAJOR=22

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

nvm install "$NODE_MAJOR" >/dev/null
nvm alias default "$NODE_MAJOR" >/dev/null
NODE_DIR="$(dirname "$(nvm which "$NODE_MAJOR")")"

# Expose the nvm-managed node ahead of the daemon's bundled node. The daemon
# prepends /exec-daemon to PATH, so we install symlinks into the first writable
# PATH directory that precedes it (typically /usr/local/cargo/bin on the base
# image). This makes `node`/`npm` resolve to >= 22.19 in plain, non-login shells.
link_dir=""
IFS=':' read -ra path_parts <<<"$PATH"
for dir in "${path_parts[@]}"; do
    case "$dir" in
        */exec-daemon | */exec-daemon/*) break ;;
    esac
    if [ -n "$dir" ] && [ -d "$dir" ] && [ -w "$dir" ]; then
        link_dir="$dir"
        break
    fi
done

if [ -n "$link_dir" ]; then
    for bin in node npm npx corepack; do
        if [ -e "$NODE_DIR/$bin" ]; then
            ln -sf "$NODE_DIR/$bin" "$link_dir/$bin"
        fi
    done
    echo "Linked Node $NODE_MAJOR binaries into $link_dir"
else
    echo "WARNING: no writable PATH dir precedes /exec-daemon; relying on PATH prepend only" >&2
fi

export PATH="$NODE_DIR:$PATH"
hash -r

echo "Using node $(node --version) / npm $(npm --version)"

npm ci
npm run build

echo "ioBroker.sonos environment ready."
