import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { OutputDevice, OutputView, Status } from "../types";
import {
  HEALTH_EVERY_MS,
  HEALTH_FIRST_MS,
  OutputController,
  outputList,
  type DeviceInfo,
  type MediaDevicesLike,
  type OutputHost,
  type SinkTarget,
  type SoundProbe,
} from "./output";

const dev = (deviceId: string, groupId: string, label: string): DeviceInfo => ({ deviceId, groupId, label, kind: "audiooutput" });
const SPEAKERS = [dev("default", "g1", "Default - Speakers"), dev("speakers-id", "g1", "Speakers")];
const HEADSET = dev("headset-id", "g2", "Headset");

class FakeDevices implements MediaDevicesLike {
  current: DeviceInfo[] = [];
  enumerations = 0;
  private listener: () => void = () => undefined;
  async enumerateDevices() {
    this.enumerations += 1;
    return this.current;
  }
  addEventListener(_type: "devicechange", listener: () => void) {
    this.listener = listener;
  }
  removeEventListener(_type: "devicechange", _listener: () => void) {
    this.listener = () => undefined;
  }
  change(next: DeviceInfo[]) {
    this.current = next;
    this.listener();
  }
}

class FakeSink implements SinkTarget {
  sinkId = "";
  failWith: string | null = null;
  async setSinkId(id: string) {
    if (this.failWith && id !== "") throw new DOMException("x", this.failWith);
    this.sinkId = id;
  }
}

function setup(devices: DeviceInfo[], options: { remembered?: OutputDevice | null; setting?: boolean; probe?: SoundProbe } = {}) {
  const media = new FakeDevices();
  media.current = devices;
  const context = new FakeSink();
  const elements = [new FakeSink(), new FakeSink()];
  let status: Status = "playing";
  const statusListeners: Array<(s: Status) => void> = [];
  const commandListeners: Array<() => void> = [];
  let remembered = options.remembered ?? null;
  const views: OutputView[] = [];
  const calls = { pauses: 0, resumes: 0, lastPauseReason: "" };
  const host: OutputHost = {
    status: () => status,
    pauseForDeviceLoss: () => {
      calls.pauses += 1;
      calls.lastPauseReason = "device_lost";
      status = "paused";
    },
    resume: () => {
      calls.resumes += 1;
      status = "playing";
    },
    onCommand: (l) => (commandListeners.push(l), () => undefined),
    onStatus: (l) => (statusListeners.push(l), () => undefined),
    pauseOnDeviceLoss: () => options.setting ?? true,
    remembered: () => remembered,
    remember: (d) => (remembered = d),
    setOutput: (v) => views.push(v),
  };
  const controller = new OutputController(
    media,
    () => [context, ...elements],
    host,
    () => Date.now(),
    options.probe,
  );
  return {
    media,
    context,
    elements,
    controller,
    views,
    calls,
    get remembered() {
      return remembered;
    },
    setStatus: (s: Status) => {
      status = s;
      statusListeners.forEach((l) => l(s));
    },
    command: () => commandListeners.forEach((l) => l()),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("output device", () => {
  it("the list shows the default once, then the other devices", () => {
    expect(outputList([...SPEAKERS, HEADSET]).map((d) => d.label)).toEqual(["System default (Speakers)", "Headset"]);
  });

  it("a remembered device is found by label after ids change; otherwise the default plays", async () => {
    const s = setup([...SPEAKERS, dev("new-id", "g2", "Headset")], { remembered: { id: "old-id", label: "Headset" } });
    await s.controller.init();
    expect(s.context.sinkId).toBe("new-id");
    expect(s.remembered).toEqual({ id: "new-id", label: "Headset" });
    const n = setup([...SPEAKERS], { remembered: { id: "old-id", label: "Headset" } });
    await n.controller.init();
    expect(n.context.sinkId).toBe("");
    expect(n.remembered).toEqual({ id: "old-id", label: "Headset" });
  });

  it("choosing sets the context and both elements; a refusal falls back with an error", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.list();
    await s.controller.choose("headset-id");
    expect([s.context.sinkId, ...s.elements.map((e) => e.sinkId)]).toEqual(["headset-id", "headset-id", "headset-id"]);
    await s.controller.choose(null);
    expect(s.context.sinkId).toBe("");
    s.context.failWith = "NotFoundError";
    await s.controller.choose("headset-id");
    expect(s.context.sinkId).toBe("");
    expect(s.views.at(-1)?.error).toBe("NotFoundError");
    const prevChosen = s.views.at(-1)?.chosen;
    await s.controller.choose("unknown-id");
    expect(s.context.sinkId).toBe("");
    expect(s.views.at(-1)?.chosen).toEqual(prevChosen);
  });

  it("the remembered device falls back and returns", async () => {
    const s = setup([...SPEAKERS, HEADSET], { setting: false });
    await s.controller.init();
    await s.controller.list();
    await s.controller.choose("headset-id");
    s.media.change([...SPEAKERS]);
    await settle();
    expect(s.views.at(-1)?.fellBack).toBe(true);
    expect(s.context.sinkId).toBe("");
    s.media.change([...SPEAKERS, HEADSET]);
    await settle();
    expect(s.views.at(-1)?.fellBack).toBe(false);
    expect(s.context.sinkId).toBe("headset-id");
  });

  it("a new webcam never pauses", async () => {
    const s = setup([...SPEAKERS]);
    await s.controller.init();
    s.media.change([...SPEAKERS, dev("cam", "g9", "Webcam")]);
    await settle();
    expect(s.calls.pauses).toBe(0);
  });

  it("the default moving to another existing device does not pause", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    s.media.change([dev("default", "g2", "Default - Headset"), dev("speakers-id", "g1", "Speakers"), HEADSET]);
    await settle();
    expect(s.calls.pauses).toBe(0);
  });

  it("chosen device stays put while the system default changes", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    await s.controller.choose("headset-id");
    expect(s.context.sinkId).toBe("headset-id");
    s.media.change([dev("default", "g2", "Default - Headset"), dev("speakers-id", "g1", "Speakers"), HEADSET]);
    await settle();
    expect(s.context.sinkId).toBe("headset-id");
    expect(s.calls.pauses).toBe(0);
  });

  it("the explicit headset disappearing pauses within 300 ms", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    await s.controller.list();
    await s.controller.choose("headset-id");
    s.media.change([...SPEAKERS]);
    await settle();
    expect(s.calls.pauses).toBe(1);
    expect(s.calls.lastPauseReason).toBe("device_lost");
  });

  it("the device behind the default disappearing pauses", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    s.media.change([dev("default", "g2", "Default - Headset"), HEADSET]);
    await settle();
    expect(s.calls.pauses).toBe(1);
    expect(s.calls.lastPauseReason).toBe("device_lost");
  });

  async function lostHeadset() {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    await s.controller.list();
    await s.controller.choose("headset-id");
    s.media.change([...SPEAKERS]);
    await settle();
    return s;
  }

  it("the headset returning within 2 minutes resumes on it", async () => {
    const s = await lostHeadset();
    await vi.advanceTimersByTimeAsync(90_000);
    s.media.change([...SPEAKERS, HEADSET]);
    await settle();
    expect(s.calls.resumes).toBe(1);
    expect(s.context.sinkId).toBe("headset-id");
  });

  it("after 2 minutes it stays paused", async () => {
    const s = await lostHeadset();
    await vi.advanceTimersByTimeAsync(130_000);
    s.media.change([...SPEAKERS, HEADSET]);
    await settle();
    expect(s.calls.resumes).toBe(0);
  });

  it("any command cancels the auto-resume", async () => {
    const s = await lostHeadset();
    s.command();
    await vi.advanceTimersByTimeAsync(30_000);
    s.media.change([...SPEAKERS, HEADSET]);
    await settle();
    expect(s.calls.resumes).toBe(0);
  });

  it("a burst of changes gives one enumeration and one decision", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    const beforeEnumerations = s.media.enumerations;
    const beforeDecisions = s.views.length;
    s.media.change([...SPEAKERS, HEADSET]);
    await vi.advanceTimersByTimeAsync(100);
    s.media.change([...SPEAKERS, HEADSET]);
    await vi.advanceTimersByTimeAsync(100);
    s.media.change([...SPEAKERS]);
    await settle();
    expect(s.media.enumerations - beforeEnumerations).toBe(1);
    expect(s.views.length - beforeDecisions).toBe(1);
  });

  it("with the setting off playback continues on the default", async () => {
    const s = setup([...SPEAKERS, HEADSET], { setting: false });
    await s.controller.init();
    await s.controller.list();
    await s.controller.choose("headset-id");
    s.media.change([...SPEAKERS]);
    await settle();
    expect(s.calls.pauses).toBe(0);
    expect(s.context.sinkId).toBe("");
  });

  it("a user pause is never resumed by a returning device", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    await s.controller.list();
    await s.controller.choose("headset-id");
    s.setStatus("paused");
    s.media.change([...SPEAKERS]);
    await settle();
    s.media.change([...SPEAKERS, HEADSET]);
    await settle();
    expect(s.calls.resumes).toBe(0);
    expect(s.calls.pauses).toBe(0);
  });

  it("dispose stops listening and ignores further device changes", async () => {
    const s = setup([...SPEAKERS, HEADSET]);
    await s.controller.init();
    await s.controller.choose("headset-id");
    s.controller.dispose();
    const beforePauses = s.calls.pauses;
    const beforeViews = s.views.length;
    s.media.change([...SPEAKERS]);
    await settle();
    expect(s.calls.pauses).toBe(beforePauses);
    expect(s.views.length).toBe(beforeViews);
  });

  describe("a playing track nobody hears", () => {
    function probe() {
      const state = { context: "running" as string | null, muted: false as boolean | null, unmutes: 0 };
      const port: SoundProbe = {
        contextState: () => state.context,
        systemMuted: async () => state.muted,
        unmuteSystem: async () => {
          state.unmutes += 1;
          state.muted = false;
        },
      };
      return { state, port };
    }
    const look = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    it("a stream the system mixer keeps muted is named once playback starts, and Unmute clears it", async () => {
      const p = probe();
      p.state.muted = true;
      const s = setup([...SPEAKERS], { probe: p.port });
      await s.controller.init();
      s.setStatus("playing");
      await look(HEALTH_FIRST_MS);
      expect(s.views.at(-1)?.silent).toBe("system_muted");
      await s.controller.unmute();
      expect(p.state.unmutes).toBe(1);
      expect(s.views.at(-1)?.silent).toBeUndefined();
    });

    it("a context that stays stopped is named after two looks, a passing hiccup is not", async () => {
      const p = probe();
      const s = setup([...SPEAKERS], { probe: p.port });
      await s.controller.init();
      s.setStatus("playing");
      p.state.context = "suspended";
      await look(HEALTH_FIRST_MS);
      expect(s.views.at(-1)?.silent).toBeUndefined();
      await look(HEALTH_EVERY_MS);
      expect(s.views.at(-1)?.silent).toBe("output_stopped");
      p.state.context = "running";
      await look(HEALTH_EVERY_MS);
      expect(s.views.at(-1)?.silent).toBeUndefined();
    });

    it("pausing drops the warning and stops looking; an unknown mixer says nothing", async () => {
      const p = probe();
      p.state.muted = true;
      const s = setup([...SPEAKERS], { probe: p.port });
      await s.controller.init();
      s.setStatus("playing");
      await look(HEALTH_FIRST_MS);
      s.setStatus("paused");
      expect(s.views.at(-1)?.silent).toBeUndefined();
      const views = s.views.length;
      await look(HEALTH_EVERY_MS * 3);
      expect(s.views.length).toBe(views);
      p.state.muted = null;
      s.setStatus("playing");
      await look(HEALTH_FIRST_MS);
      expect(s.views.at(-1)?.silent).toBeUndefined();
    });
  });
});
