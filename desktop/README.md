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

Once the widget is installed in your own extensions folder, Nuvo keeps it current: when the app brings a newer widget,
it reinstalls it on start and says so once. Log out and back in to see the new one.

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

## QuickShell and other MPRIS widgets

Any widget that reads MPRIS shows Nuvo with no setup: title, artist, album, cover, length, position, play and pause,
next, previous and seeking. Nuvo's player calls itself `Nuvo` (its `Identity`). A QuickShell bar item, for example:

```qml
import QtQuick
import Quickshell.Services.Mpris

Row {
  id: nuvo
  readonly property MprisPlayer player: Mpris.players.values.find((p) => p.identity === "Nuvo") ?? null
  visible: player !== null
  spacing: 8

  Image {
    width: 20
    height: 20
    source: nuvo.player?.trackArtUrl ?? ""
    fillMode: Image.PreserveAspectCrop
  }
  Text {
    text: `${nuvo.player?.trackTitle ?? ""} · ${nuvo.player?.trackArtist ?? ""}`
    MouseArea {
      anchors.fill: parent
      acceptedButtons: Qt.LeftButton | Qt.RightButton
      onClicked: (mouse) => mouse.button === Qt.RightButton ? nuvo.player.next() : nuvo.player.togglePlaying()
    }
  }
  // QuickShell reads the position on demand; this keeps a progress bar moving
  Timer {
    running: nuvo.player?.isPlaying ?? false
    interval: 1000
    repeat: true
    onTriggered: nuvo.player.positionChanged()
  }
}
```

Like, dislike and the lyrics line come from the D-Bus interface below.

## The Notch next to a bar

On Hyprland and Sway a bar drawn by the shell stays above every window, so by default the Notch sits right below it.
**Settings > Notch > Placement** moves it: the screen, the side, the top edge (screen edge or below the bar), a gap and,
outside Hyprland and Sway, whether it stays above everything.

## The D-Bus interface

Playback, metadata and the cover come from Nuvo's MPRIS player, the standard one every desktop reads. What MPRIS
can't carry, Nuvo publishes on the **session bus only** while it runs:

|           |                           |
| --------- | ------------------------- |
| Bus name  | `quest.nuvo.Nuvo.Player`  |
| Object    | `/quest/nuvo/Nuvo/Player` |
| Interface | `quest.nuvo.Nuvo.Player`  |

| Member             | Type         |                                                                                                                     |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `MprisName`        | property `s` | Nuvo's MPRIS bus name, so a widget finds the right player without guessing                                          |
| `TrackId`          | property `s` | Nuvo's ID of the playing song, empty when nothing plays                                                             |
| `Liked`            | property `b` | the playing song is in Liked songs                                                                                  |
| `LyricsLine`       | property `s` | the line being sung, empty without timed lyrics                                                                     |
| `LyricsJson`       | property `s` | the playing song's timed lyrics as a JSON array of `{ timeMs, text }`, at most 500 lines, `[]` without timed lyrics |
| `UpNextJson`       | property `s` | the next songs in the queue as a JSON array of `{ id, title, artist, coverUrl, durationMs }`, at most 3             |
| `ToggleLike()`     | method       | like or unlike the playing song                                                                                     |
| `PlayUpNext(s id)` | method       | plays the song with this `id` from `UpNextJson`; any other ID is ignored                                            |
| `Dislike()`        | method       | "Not interested" in the playing song; it skips to the next one                                                      |
| `Show()`           | method       | brings the Nuvo window up                                                                                           |

Properties are read-only and announced with `org.freedesktop.DBus.Properties.PropertiesChanged`. `ToggleLike` and `Dislike` do
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
