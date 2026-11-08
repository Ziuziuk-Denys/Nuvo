#!/bin/sh
# Screenshots of the harness in light and dark: run serve.mjs first
out="$(dirname "$0")/../artifacts/sound"
mkdir -p "$out"
profile="$out/.chrome-profile"
for theme in light dark; do
  for scene in preset custom off clip; do
    google-chrome --headless=new --user-data-dir="$profile" --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
      --window-size=608,470 --virtual-time-budget=4000 \
      --screenshot="$out/eq-$scene-$theme.png" \
      "http://localhost:5199/e2e/sound/harness.html?theme=$theme&scene=$scene" 2>/dev/null
  done
done
rm -rf "$profile"
ls "$out"
