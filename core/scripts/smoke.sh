#!/usr/bin/env bash
# Runs the real binary against throwaway directories and a test keyring item, then cleans up.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -q -p nuvo-server
work=$(mktemp -d)
sock="$XDG_RUNTIME_DIR/nuvo-smoke-$$/core.sock"
token=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
pid=
mkfifo "$work/stdin"
cleanup() {
  secret-tool clear service nuvo-core-test username master-key || true
  kill "$pid" 2>/dev/null || true
  rm -rf "$work" "$(dirname "$sock")"
}
trap cleanup EXIT
(exec 3>"$work/stdin"; sleep 6) &
env -i HOME="$work" PATH="$PATH" DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" \
  XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" XDG_STATE_HOME="$work/state" \
  NUVO_CORE_SOCKET="$sock" NUVO_CORE_TOKEN="$token" NUVO_CORE_KEYRING_SERVICE=nuvo-core-test \
  NUVO_CORE_EXIT_ON_STDIN_EOF=1 ./target/debug/nuvo-core <"$work/stdin" &
pid=$!
for _ in $(seq 100); do [ -S "$sock" ] && break; sleep 0.05; done
c() { curl -s --unix-socket "$sock" -H "authorization: Bearer $token" "$@"; echo; }
c http://local/health
c -X PUT http://local/v1/me/library/tracks/t1 -w '%{http_code}' \
  -d '{"track":{"id":"t1","title":"Bohemian Rhapsody","artists":[{"id":"q","name":"Queen"}],"durationMs":354000}}'
c 'http://local/v1/me/library/tracks?limit=10'
c http://local/v1/tracks/t1/lyrics | cut -c1-120
c -X PUT http://local/v1/cache/audio/t1 -H "content-type: audio/webm" --data-binary @<(head -c 1024 /dev/urandom) > /dev/null
c -H "range: bytes=0-99" http://local/v1/cache/audio/t1 | wc -c
curl -s --unix-socket "$sock" http://local/health -w ' %{http_code}'; echo
head -c 16 "$work/data/nuvo/library.db" | od -c | head -1
sleep 6.5
if kill -0 "$pid" 2>/dev/null; then echo "FAIL: daemon ignored stdin EOF"; exit 1; fi
[ -e "$sock" ] && { echo "FAIL: socket left behind"; exit 1; }
echo "smoke ok"
