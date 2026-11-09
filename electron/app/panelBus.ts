import type { NotchLyrics } from "../../src/notch/contracts";
import { activeLineIndex, msUntilNextLine, positionAt } from "../../src/notch/lib/playback";
import type { RemoteCommand, SurfaceState } from "../../src/engine/types";
import { BusConnection, socketPathOf, type Message, type Variant } from "./dbus";

export const BUS_NAME = "quest.nuvo.Nuvo.Player";
export const OBJECT_PATH = "/quest/nuvo/Nuvo/Player";
export const INTERFACE = "quest.nuvo.Nuvo.Player";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const LYRICS_LINE_MAX = 200;

export const INTROSPECTION = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="${INTERFACE}">
    <property name="MprisName" type="s" access="read"/>
    <property name="Liked" type="b" access="read"/>
    <property name="LyricsLine" type="s" access="read"/>
    <method name="ToggleLike"/>
    <method name="Dislike"/>
    <method name="Show"/>
  </interface>
  <interface name="${PROPERTIES}">
    <method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method>
    <signal name="PropertiesChanged"><arg type="s"/><arg type="a{sv}"/><arg type="as"/></signal>
  </interface>
  <interface name="org.freedesktop.DBus.Introspectable">
    <method name="Introspect"><arg type="s" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.DBus.Peer">
    <method name="Ping"/>
  </interface>
</node>
`;

export interface PanelBusLike {
  onCall: (call: Message) => void;
  reply(call: Message, signature?: string, body?: unknown[]): void;
  error(call: Message, name: string, text: string): void;
  signal(message: Omit<Message, "type">): void;
}

export interface PanelDeps {
  mprisName: string;
  command(command: RemoteCommand): void;
  show(): void;
  now(): number;
}

interface Exposed {
  MprisName: string;
  Liked: boolean;
  LyricsLine: string;
}

const TYPES: Record<keyof Exposed, string> = { MprisName: "s", Liked: "b", LyricsLine: "s" };

export class PanelService {
  private state: SurfaceState | null = null;
  private lyrics: NotchLyrics | null = null;
  private exposed: Exposed;
  private lineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bus: PanelBusLike,
    private readonly deps: PanelDeps,
  ) {
    this.exposed = { MprisName: deps.mprisName, Liked: false, LyricsLine: "" };
    bus.onCall = (call) => this.handle(call);
  }

  get properties(): Readonly<Exposed> {
    return this.exposed;
  }

  update(state: SurfaceState): void {
    this.state = state;
    this.refresh();
  }

  setLyrics(lyrics: NotchLyrics): void {
    this.lyrics = lyrics;
    this.refresh();
  }

  dispose(): void {
    if (this.lineTimer) clearTimeout(this.lineTimer);
    this.lineTimer = null;
  }

  private refresh(): void {
    if (this.lineTimer) clearTimeout(this.lineTimer);
    this.lineTimer = null;
    const state = this.state;
    const hasTrack = Boolean(state?.trackId);
    let line = "";
    const lines = state && this.lyrics?.trackId === state.trackId ? this.lyrics.lines : [];
    if (state && hasTrack && lines.length > 0) {
      const playing = state.status === "playing";
      const position = positionAt({ positionMs: state.positionMs, sampledAt: state.sampledAt, playing, durationMs: state.durationMs }, this.deps.now());
      line = lines[activeLineIndex(lines, position)]?.text.slice(0, LYRICS_LINE_MAX) ?? "";
      const wait = playing ? msUntilNextLine(lines, position) : null;
      if (wait !== null) this.lineTimer = setTimeout(() => this.refresh(), wait);
    }
    this.publish({ MprisName: this.deps.mprisName, Liked: hasTrack && Boolean(state?.liked), LyricsLine: line });
  }

  private publish(next: Exposed): void {
    const changed: Array<[string, Variant]> = [];
    for (const key of Object.keys(TYPES) as Array<keyof Exposed>) {
      if (next[key] !== this.exposed[key]) changed.push([key, [TYPES[key], next[key]]]);
    }
    this.exposed = next;
    if (changed.length === 0) return;
    this.bus.signal({ path: OBJECT_PATH, interface: PROPERTIES, member: "PropertiesChanged", signature: "sa{sv}as", body: [INTERFACE, changed, []] });
  }

  private all(): Array<[string, Variant]> {
    return (Object.keys(TYPES) as Array<keyof Exposed>).map((key) => [key, [TYPES[key], this.exposed[key]]]);
  }

  private handle(call: Message): void {
    const bus = this.bus;
    if (call.path !== OBJECT_PATH) return bus.error(call, "org.freedesktop.DBus.Error.UnknownObject", `No object at ${call.path}`);
    const where = `${call.interface ?? ""}.${call.member ?? ""}`;
    const args = call.body ?? [];
    switch (where) {
      case "org.freedesktop.DBus.Introspectable.Introspect":
        return bus.reply(call, "s", [INTROSPECTION]);
      case "org.freedesktop.DBus.Peer.Ping":
        return bus.reply(call);
      case `${PROPERTIES}.GetAll`:
        return bus.reply(call, "a{sv}", [args[0] === INTERFACE ? this.all() : []]);
      case `${PROPERTIES}.Get`: {
        const key = args[1] as keyof Exposed;
        if (args[0] !== INTERFACE || !(key in TYPES)) return bus.error(call, "org.freedesktop.DBus.Error.UnknownProperty", `No property ${String(args[1])}`);
        return bus.reply(call, "v", [[TYPES[key], this.exposed[key]]]);
      }
      case `${PROPERTIES}.Set`:
        return bus.error(call, "org.freedesktop.DBus.Error.PropertyReadOnly", "Every property is read-only");
      case `${INTERFACE}.ToggleLike`:
        if (this.state?.trackId) this.deps.command({ type: this.state.liked ? "unlike" : "like" });
        return bus.reply(call);
      case `${INTERFACE}.Dislike`:
        if (this.state?.trackId) this.deps.command({ type: "dislike" });
        return bus.reply(call);
      case `${INTERFACE}.Show`:
        this.deps.show();
        return bus.reply(call);
      default:
        return bus.error(call, "org.freedesktop.DBus.Error.UnknownMethod", `No method ${where}`);
    }
  }
}

export interface PanelBus {
  service: PanelService;
  close(): void;
}

export async function startPanelBus(deps: PanelDeps, env: NodeJS.ProcessEnv = process.env, uid = process.getuid?.() ?? 0): Promise<PanelBus | null> {
  const socketPath = socketPathOf(env.DBUS_SESSION_BUS_ADDRESS);
  if (!socketPath) return null;
  let bus: BusConnection | null = null;
  try {
    bus = await BusConnection.open(socketPath, uid);
    const service = new PanelService(bus, deps);
    // 4: do not queue; a second owner stays out instead of waiting
    const [code] = await bus.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "RequestName",
      signature: "su",
      body: [BUS_NAME, 4],
    });
    if (code !== 1) throw new Error(`${BUS_NAME} is owned by another process`);
    const connection = bus;
    return {
      service,
      close: () => {
        service.dispose();
        connection.close();
      },
    };
  } catch (error) {
    console.warn("[panel] session bus unavailable:", error);
    bus?.close();
    return null;
  }
}
