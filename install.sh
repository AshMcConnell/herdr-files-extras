#!/bin/sh
# Install (or refresh) the mod into the running Herdr app from this checkout.
#
# The destination is always a real folder: a symlink to this checkout loads,
# but saves in it don't hot-reload (and icons fail to resolve), so we copy.
# Herdr hot-reloads the installed copy when the files change here, which is
# what makes `--watch` a live dev loop.
#
#   ./install.sh          install once, then `herdr-app check` the result
#   ./install.sh --watch  keep reinstalling on every save until ctrl-c
#
# HERDR_APP_HOME selects the app home, like the herdr-app commands do.

set -e
SRC="$(cd "$(dirname "$0")" && pwd)/mods/files-extras"
DEST="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/files-extras"
RSYNC="rsync -a --delete --exclude .DS_Store"

install_once() {
  mkdir -p "$DEST"
  $RSYNC "$SRC/" "$DEST/"
  if command -v herdr-app >/dev/null 2>&1; then
    herdr-app check "$DEST"
  fi
  echo "Installed → $DEST"
}

if [ "${1:-}" = "--watch" ]; then
  echo "Watching $SRC — installing on every change (ctrl-c to stop)"
  install_once
  while :; do
    CHANGED=$($RSYNC -i "$SRC/" "$DEST/" || true)
    [ -n "$CHANGED" ] && echo "Reloaded: $CHANGED"
    sleep 1
  done
else
  install_once
fi
