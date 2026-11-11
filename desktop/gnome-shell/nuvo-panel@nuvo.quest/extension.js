import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import St from "gi://St";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

const NUVO_NAME = "quest.nuvo.Nuvo.Player";
const NUVO_PATH = "/quest/nuvo/Nuvo/Player";
const MPRIS_PATH = "/org/mpris/MediaPlayer2";
const PLAYER_IFACE = "org.mpris.MediaPlayer2.Player";
// the Nuvo accent of the dark preset, for songs without a colourful cover
const FALLBACK_GLOW = [175, 200, 247];

const NuvoProxy = Gio.DBusProxy.makeProxyWrapper(`<node>
  <interface name="quest.nuvo.Nuvo.Player">
    <property name="MprisName" type="s" access="read"/>
    <property name="Liked" type="b" access="read"/>
    <property name="LyricsLine" type="s" access="read"/>
    <method name="ToggleLike"/>
    <method name="Dislike"/>
    <method name="Show"/>
  </interface>
</node>`);

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(`<node>
  <interface name="${PLAYER_IFACE}">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
  </interface>
</node>`);

function coverGlow(uri) {
  try {
    const path = Gio.File.new_for_uri(uri).get_path();
    const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 24, 24, false);
    const pixels = pixbuf.get_pixels();
    const channels = pixbuf.get_n_channels();
    const stride = pixbuf.get_rowstride();
    let red = 0,
      green = 0,
      blue = 0,
      count = 0;
    for (let y = 0; y < pixbuf.get_height(); y++) {
      for (let x = 0; x < pixbuf.get_width(); x++) {
        const at = y * stride + x * channels;
        const [r, g, b] = [pixels[at], pixels[at + 1], pixels[at + 2]];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max < 48 || (max - min) / max < 0.2) continue;
        red += r;
        green += g;
        blue += b;
        count++;
      }
    }
    return count > 0 ? [red, green, blue].map((v) => Math.round(v / count)) : FALLBACK_GLOW;
  } catch {
    return FALLBACK_GLOW;
  }
}

function formatTime(us) {
  const total = Math.max(0, Math.floor(us / 1e6));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function iconButton(iconName, styleClass, accessibleName, onClick) {
  const button = new St.Button({
    style_class: `nuvo-button ${styleClass}`,
    can_focus: true,
    accessible_name: accessibleName,
    child: new St.Icon({ style_class: "nuvo-button-icon" }),
  });
  button.child.gicon = iconName;
  button.connect("clicked", onClick);
  return button;
}

const NuvoIndicator = GObject.registerClass(
  class NuvoIndicator extends PanelMenu.Button {
    _init(extension) {
      super._init(0.5, "Nuvo");
      this._ext = extension;
      this._nuvo = null;
      this._player = null;
      this._artUrl = null;
      this._positionTimer = 0;
      this.add_style_class_name("nuvo-indicator");
      this.visible = false;

      const box = new St.BoxLayout({ style_class: "nuvo-panel-box" });
      this._thumb = new St.Bin({ style_class: "nuvo-thumb", y_align: Clutter.ActorAlign.CENTER });
      this._label = new St.Label({ style_class: "nuvo-panel-label", y_align: Clutter.ActorAlign.CENTER });
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      box.add_child(this._thumb);
      box.add_child(this._label);
      this.add_child(box);

      this._buildCard();
      this.menu.connectObject("open-state-changed", (_menu, open) => this._followPosition(open), this);

      this._watch = Gio.bus_watch_name(
        Gio.BusType.SESSION,
        NUVO_NAME,
        Gio.BusNameWatcherFlags.NONE,
        () => this._connectNuvo(),
        () => this._dropNuvo(),
      );
    }

    _icon(name) {
      return Gio.icon_new_for_string(`${this._ext.path}/icons/${name}.svg`);
    }

    _buildCard() {
      const item = new PopupMenu.PopupBaseMenuItem({ activate: false, hover: false, can_focus: false, style_class: "nuvo-card-item" });
      const card = new St.BoxLayout({ style_class: "nuvo-card", vertical: true, x_expand: true });
      this._card = card;

      const head = new St.BoxLayout({ style_class: "nuvo-head" });
      this._cover = new St.Button({ style_class: "nuvo-cover", accessible_name: "Open Nuvo", can_focus: true });
      this._cover.connect("clicked", () => this._open());
      const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: "nuvo-text" });
      this._title = new St.Label({ style_class: "nuvo-title" });
      this._artist = new St.Label({ style_class: "nuvo-artist" });
      this._lyrics = new St.Label({ style_class: "nuvo-lyrics" });
      for (const label of [this._title, this._artist, this._lyrics]) {
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(label);
      }
      const textButton = new St.Button({ child: text, x_expand: true, can_focus: false, style_class: "nuvo-text-button" });
      textButton.connect("clicked", () => this._open());
      head.add_child(this._cover);
      head.add_child(textButton);

      const progress = new St.BoxLayout({ vertical: true, style_class: "nuvo-progress" });
      this._rail = new St.Widget({ style_class: "nuvo-rail", x_expand: true });
      this._fill = new St.Widget({ style_class: "nuvo-fill", width: 0 });
      this._rail.add_child(this._fill);
      const times = new St.BoxLayout({ style_class: "nuvo-times" });
      this._elapsed = new St.Label({ style_class: "nuvo-time", x_expand: true });
      this._total = new St.Label({ style_class: "nuvo-time" });
      times.add_child(this._elapsed);
      times.add_child(this._total);
      progress.add_child(this._rail);
      progress.add_child(times);

      const controls = new St.BoxLayout({ style_class: "nuvo-controls", x_align: Clutter.ActorAlign.CENTER });
      this._dislike = iconButton(this._icon("nuvo-dislike-symbolic"), "nuvo-side", "Dislike", () => this._callNuvo("DislikeAsync"));
      const previous = iconButton(Gio.ThemedIcon.new("media-skip-backward-symbolic"), "nuvo-skip", "Previous", () => this._callPlayer("PreviousAsync"));
      this._play = iconButton(Gio.ThemedIcon.new("media-playback-start-symbolic"), "nuvo-play", "Play or pause", () => this._callPlayer("PlayPauseAsync"));
      const next = iconButton(Gio.ThemedIcon.new("media-skip-forward-symbolic"), "nuvo-skip", "Next", () => this._callPlayer("NextAsync"));
      this._like = iconButton(this._icon("nuvo-like-symbolic"), "nuvo-side", "Like", () => this._callNuvo("ToggleLikeAsync"));
      for (const button of [this._dislike, previous, this._play, next, this._like]) controls.add_child(button);

      card.add_child(head);
      card.add_child(progress);
      card.add_child(controls);
      item.add_child(card);
      this.menu.addMenuItem(item);
    }

    _connectNuvo() {
      this._nuvo = new NuvoProxy(Gio.DBus.session, NUVO_NAME, NUVO_PATH, (proxy, error) => {
        if (error || this._nuvo !== proxy) return;
        proxy.connectObject("g-properties-changed", () => this._onNuvoChanged(), this);
        this._onNuvoChanged();
      });
    }

    _onNuvoChanged() {
      const name = this._nuvo?.MprisName ?? "";
      if (name && this._player?.g_name !== name) this._connectPlayer(name);
      this._sync();
    }

    _connectPlayer(name) {
      this._player?.disconnectObject(this);
      this._player = new PlayerProxy(Gio.DBus.session, name, MPRIS_PATH, (proxy, error) => {
        if (error || this._player !== proxy) return;
        proxy.connectObject("g-properties-changed", () => this._sync(), this);
        this._sync();
      });
    }

    _dropNuvo() {
      this._nuvo?.disconnectObject(this);
      this._player?.disconnectObject(this);
      this._nuvo = null;
      this._player = null;
      this.menu.close();
      this._sync();
    }

    _callPlayer(method) {
      this._player?.[method]().catch(logError);
    }

    _callNuvo(method) {
      this._nuvo?.[method]().catch(logError);
    }

    _open() {
      this.menu.close();
      this._callNuvo("ShowAsync");
    }

    _metadata() {
      return this._player?.get_cached_property("Metadata")?.recursiveUnpack() ?? {};
    }

    _sync() {
      const meta = this._metadata();
      const status = this._player?.PlaybackStatus ?? "Stopped";
      const title = typeof meta["xesam:title"] === "string" ? meta["xesam:title"] : "";
      const artists = Array.isArray(meta["xesam:artist"]) ? meta["xesam:artist"].join(", ") : "";
      const live = Boolean(this._nuvo?.g_name_owner && this._player?.g_name_owner && title && status !== "Stopped");
      this.visible = live;
      if (!live) return;

      this._label.text = title;
      this._label.opacity = status === "Playing" ? 255 : 160;
      this._title.text = title;
      this._artist.text = artists;
      const line = this._nuvo.LyricsLine ?? "";
      if (line !== this._lyrics.text) {
        this._lyrics.text = line;
        this._lyrics.opacity = 0;
        this._lyrics.ease({ opacity: 255, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
      }
      this._lyrics.visible = line !== "";
      this._length = Number(meta["mpris:length"] ?? 0);
      this._total.text = this._length > 0 ? formatTime(this._length) : "";
      const artUrl = typeof meta["mpris:artUrl"] === "string" ? meta["mpris:artUrl"] : "";
      if (artUrl !== this._artUrl) {
        this._artUrl = artUrl;
        const picture = artUrl ? `background-image: url("${artUrl}");` : "";
        const [r, g, b] = artUrl ? coverGlow(artUrl) : FALLBACK_GLOW;
        this._glow = [r, g, b];
        this._thumb.style = picture;
        this._cover.style = `${picture} box-shadow: 0 6px 22px 0 rgba(${r}, ${g}, ${b}, 0.55);`;
        this._fill.style = `background-color: rgb(${r}, ${g}, ${b});`;
        this._card.style = `background-gradient-start: rgba(${r}, ${g}, ${b}, 0.16); background-gradient-end: rgba(${r}, ${g}, ${b}, 0);`;
        this._play.style = `border: 1.5px solid rgba(${r}, ${g}, ${b}, 0.7); box-shadow: 0 0 14px 0 rgba(${r}, ${g}, ${b}, 0.3);`;
        this._thumb.child = artUrl ? null : new St.Icon({ gicon: this._icon("nuvo-symbolic"), style_class: "nuvo-thumb-icon" });
      }
      this._play.child.gicon = Gio.ThemedIcon.new(status === "Playing" ? "media-playback-pause-symbolic" : "media-playback-start-symbolic");
      const liked = Boolean(this._nuvo.Liked);
      this._like.child.gicon = this._icon(liked ? "nuvo-liked-symbolic" : "nuvo-like-symbolic");
      this._like.accessible_name = liked ? "Remove like" : "Like";
      this._like.checked = liked;
      this._like.child.style = liked && this._glow ? `color: rgb(${this._glow.join(", ")});` : "";
    }

    /* MPRIS does not signal the position, so the card asks once a second while it is open. */
    _followPosition(open) {
      if (this._positionTimer) {
        GLib.source_remove(this._positionTimer);
        this._positionTimer = 0;
      }
      if (!open) return;
      this._readPosition();
      this._positionTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._readPosition();
        return GLib.SOURCE_CONTINUE;
      });
    }

    _readPosition() {
      const player = this._player;
      if (!player?.g_name_owner) return;
      player.g_connection.call(
        player.g_name,
        MPRIS_PATH,
        "org.freedesktop.DBus.Properties",
        "Get",
        new GLib.Variant("(ss)", [PLAYER_IFACE, "Position"]),
        null,
        Gio.DBusCallFlags.NONE,
        1000,
        null,
        (connection, result) => {
          try {
            const position = Number(connection.call_finish(result).recursiveUnpack()[0]);
            if (this._player !== player) return;
            const fraction = this._length > 0 ? Math.min(1, Math.max(0, position / this._length)) : 0;
            this._fill.width = Math.round(this._rail.width * fraction);
            this._elapsed.text = formatTime(position);
          } catch {}
        },
      );
    }

    destroy() {
      this._followPosition(false);
      if (this._watch) {
        Gio.bus_unwatch_name(this._watch);
        this._watch = 0;
      }
      this._nuvo?.disconnectObject(this);
      this._player?.disconnectObject(this);
      this._nuvo = null;
      this._player = null;
      super.destroy();
    }
  },
);

export default class NuvoPanelExtension extends Extension {
  enable() {
    this._indicator = new NuvoIndicator(this);
    Main.panel.addToStatusArea(this.uuid, this._indicator, 1, "center");
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
