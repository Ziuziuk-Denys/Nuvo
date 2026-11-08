// Automation script for a headless GNOME Shell (see gnome-check.sh): opens the Nuvo card,
// presses like and play, and saves screenshots plus a JSON summary to $NUVO_SHOT_DIR.
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Scripting from "resource:///org/gnome/shell/ui/scripting.js";

export const METRICS = {};

const dir = GLib.getenv("NUVO_SHOT_DIR");

function shot(name) {
  const stream = Gio.File.new_for_path(`${dir}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
  return new Promise((resolve) => {
    new Shell.Screenshot().screenshot(false, stream, (shooter, result) => {
      shooter.screenshot_finish(result);
      stream.close(null);
      resolve();
    });
  });
}

function read(indicator) {
  return {
    visible: indicator?.visible ?? null,
    panelLabel: indicator?._label.text ?? null,
    title: indicator?._title.text ?? null,
    artist: indicator?._artist.text ?? null,
    lyrics: indicator?._lyrics.text ?? null,
    elapsed: indicator?._elapsed.text ?? null,
    total: indicator?._total.text ?? null,
    liked: indicator?._like.checked ?? null,
    playIcon: indicator?._play.child.gicon?.to_string() ?? null,
  };
}

export async function run() {
  Main.overview.hide();
  await Scripting.sleep(4000);
  const indicator = Main.panel.statusArea["nuvo-panel@nuvo.quest"];
  const result = { found: Boolean(indicator), start: read(indicator) };
  await shot("1-panel");
  indicator.menu.open();
  await Scripting.sleep(2500);
  result.open = read(indicator);
  await shot("2-card");
  indicator._like.emit("clicked", 1);
  indicator._play.emit("clicked", 1);
  await Scripting.sleep(1500);
  result.afterLikeAndPause = read(indicator);
  await shot("3-unliked-paused");
  indicator._dislike.emit("clicked", 1);
  await Scripting.sleep(1500);
  result.afterDislike = read(indicator);
  await shot("4-after-dislike");
  indicator.menu.close();
  GLib.file_set_contents(`${dir}/result.json`, JSON.stringify(result, null, 2));
}
