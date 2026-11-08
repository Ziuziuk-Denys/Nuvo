# Nuvo panel widgets

Nuvo in the desktop's own top bar, for sessions where the Notch can't be pinned (GNOME on Wayland) or where you
prefer the panel: the cover, title and artist, play and pause, next and previous, like and dislike, the progress
line and the current lyrics line. A click on the cover opens Nuvo.

Nuvo sets them up from **Settings > Notch** with one click. To do it by hand:

## GNOME Shell 47 to 50

```sh
pnpm panel:pack     # writes desktop/dist/nuvo-panel@nuvo.quest.shell-extension.zip
gnome-extensions install --force desktop/dist/nuvo-panel@nuvo.quest.shell-extension.zip
```

Log out and back in (Wayland loads new extensions at login), then turn on **Nuvo** in Extensions. It sits right of the clock.

## KDE Plasma 6.4 and newer

```sh
kpackagetool6 --type Plasma/Applet --install desktop/plasma/quest.nuvo.panel   # --upgrade for a newer copy
```

Right-click the panel, choose **Add Widgets** and add **Nuvo**. Middle click plays or pauses, the wheel skips.

## Waybar (Hyprland, Sway and other wlroots desktops)

Needs `jq` and `busctl` (systemd).

```sh
mkdir -p ~/.config/waybar/nuvo && cp desktop/waybar/* ~/.config/waybar/nuvo/
```

Paste the modules from `waybar/config.jsonc` into your Waybar config, add `"group/nuvo"` to a module list, and put
`@import "nuvo/style.css";` at the end of your `style.css`. Middle click on the title plays or pauses, the wheel skips.

## The D-Bus interface

Playback, metadata and the cover come from Nuvo's MPRIS player, the standard one every desktop reads. What MPRIS
can't carry, Nuvo publishes on the **session bus only** while it runs:

|           |                           |
| --------- | ------------------------- |
| Bus name  | `quest.nuvo.Nuvo.Player`  |
| Object    | `/quest/nuvo/Nuvo/Player` |
| Interface | `quest.nuvo.Nuvo.Player`  |

| Member         | Type         |                                                                            |
| -------------- | ------------ | -------------------------------------------------------------------------- |
| `MprisName`    | property `s` | Nuvo's MPRIS bus name, so a widget finds the right player without guessing |
| `Liked`        | property `b` | the playing song is in Liked songs                                         |
| `LyricsLine`   | property `s` | the line being sung, empty without timed lyrics                            |
| `ToggleLike()` | method       | like or unlike the playing song                                            |
| `Dislike()`    | method       | "Not interested" in the playing song; it skips to the next one             |
| `Show()`       | method       | brings the Nuvo window up                                                  |

Properties are read-only and announced with `org.freedesktop.DBus.Properties.PropertiesChanged`. The methods do
nothing when no song is playing. MPRIS doesn't announce the position, so widgets read `Position` while their card
is open.

## Working on the widgets

`dev/fake-nuvo.ts` is a stand-in Nuvo (the real `quest.nuvo.Nuvo.Player` service and a small MPRIS player) for a private bus.
`dev/gnome-check.sh` loads the GNOME extension into a headless GNOME Shell next to it and saves screenshots; it
doesn't touch the running desktop.

```sh
dbus-run-session -- sh -c 'node --experimental-transform-types desktop/dev/fake-nuvo.ts & sleep 1; desktop/waybar/nuvo-waybar follow'
desktop/dev/gnome-check.sh ~/.cache/nuvo-panel-check
```
