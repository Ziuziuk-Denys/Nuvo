#!/bin/sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out=${1:-"$HOME/.cache/nuvo-panel-check"}
mkdir -p "$out"
work=$(mktemp -d "$HOME/.cache/nuvo-gnome-check.XXXXXX")
trap 'rm -rf "$work"' EXIT

node "$here/../../scripts/pack-panel-widgets.mjs" "$work" >/dev/null

# shellcheck disable=SC2016 # the inner script expands its own positional arguments
NUVO_SHOT_DIR=$out dbus-run-session -- sh -c '
  node --experimental-transform-types --no-warnings "$1/fake-nuvo.ts" > "$2/fake.log" 2>&1 &
  fake=$!
  sleep 2
  gnome-shell-test-tool --headless --disable-animations --extension "$3" "$1/gnome-shot.js" > "$2/shell.log" 2>&1 || status=$?
  kill "$fake"
  exit "${status:-0}"
' sh "$here" "$out" "$work/nuvo-panel@nuvo.quest.shell-extension.zip"

cat "$out/result.json"
