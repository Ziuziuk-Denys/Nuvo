import { SYSTEM_DEFAULT, type OutputDevice, type OutputView, type Status } from "../types";

export const DEVICE_DEBOUNCE_MS = 300;
export const AUTO_RESUME_MS = 120_000;
export const HEALTH_FIRST_MS = 1500;
export const HEALTH_EVERY_MS = 5000;

export type SilentCause = "system_muted" | "output_stopped";

export interface SoundProbe {
  contextState(): string | null;
  systemMuted(): Promise<boolean | null>;
  unmuteSystem(): Promise<void>;
}

export interface DeviceInfo {
  deviceId: string;
  groupId: string;
  label: string;
  kind: string;
}

export interface MediaDevicesLike {
  enumerateDevices(): Promise<DeviceInfo[]>;
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
}

export interface SinkTarget {
  setSinkId(id: string): Promise<void>;
}

export interface OutputHost {
  status(): Status;
  pauseForDeviceLoss(): void;
  resume(): void;
  onCommand(listener: () => void): () => void;
  onStatus(listener: (status: Status) => void): () => void;
  pauseOnDeviceLoss(): boolean;
  remembered(): OutputDevice | null;
  remember(device: OutputDevice | null): void;
  setOutput(view: OutputView): void;
}

interface Physical {
  groupId: string;
  label: string;
}

export function outputList(devices: DeviceInfo[]): OutputDevice[] {
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const fallback = outputs.find((d) => d.deviceId === "default");
  const behind = fallback ? outputs.find((d) => d.deviceId !== "default" && d.groupId === fallback.groupId) : undefined;
  const list: OutputDevice[] = [];
  if (fallback) list.push({ id: "", label: `System default (${behind?.label ?? fallback.label.replace(/^Default - /, "")})` });
  for (const device of outputs) {
    if (device.deviceId === "default" || device.deviceId === "communications") continue;
    if (fallback && device.groupId === fallback.groupId) continue;
    list.push({ id: device.deviceId, label: device.label });
  }
  return list;
}

export class OutputController {
  private devices: DeviceInfo[] = [];
  private chosen: OutputDevice | null = null;
  private applied = "";
  private fellBack = false;
  private error: string | undefined;
  private active: Physical | null = null;
  private lost: (Physical & { at: number }) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private checkRunning = false;
  private checkQueued = false;
  private silent: SilentCause | undefined;
  private stoppedLooks = 0;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deviceChangeListener = () => this.scheduleCheck();
  private readonly unsubscribeCommand: () => void;
  private readonly unsubscribeStatus: () => void;

  constructor(
    private readonly media: MediaDevicesLike,
    private readonly sinks: () => SinkTarget[],
    private readonly host: OutputHost,
    private readonly now: () => number,
    private readonly probe?: SoundProbe,
  ) {
    media.addEventListener("devicechange", this.deviceChangeListener);
    this.unsubscribeCommand = host.onCommand(() => {
      this.lost = null;
    });
    this.unsubscribeStatus = host.onStatus((status) => {
      if (status === "playing") {
        this.capture();
        if (!this.healthTimer) this.scheduleHealth(HEALTH_FIRST_MS);
      } else {
        this.stopHealth();
      }
    });
  }

  // Label is the fallback: device ids are re-salted after a profile reset
  async init(): Promise<void> {
    this.devices = await this.media.enumerateDevices();
    const remembered = this.host.remembered();
    if (remembered) {
      const outputs = this.devices.filter((d) => d.kind === "audiooutput");
      const byId = outputs.find((d) => d.deviceId === remembered.id);
      const byLabel = byId ? undefined : outputs.find((d) => d.label === remembered.label && d.deviceId !== "default");
      const match = byId ?? byLabel;
      this.chosen = remembered;
      if (match) {
        if (byLabel) {
          this.chosen = { id: byLabel.deviceId, label: byLabel.label };
          this.host.remember(this.chosen);
        }
        await this.apply(match.deviceId);
      } else {
        this.fellBack = true;
        await this.apply("");
      }
    }
    this.capture();
    this.publish();
  }

  async list(): Promise<OutputDevice[]> {
    this.devices = await this.media.enumerateDevices();
    return outputList(this.devices);
  }

  dispose(): void {
    this.disposed = true;
    this.media.removeEventListener("devicechange", this.deviceChangeListener);
    this.unsubscribeCommand();
    this.unsubscribeStatus();
    if (this.timer) clearTimeout(this.timer);
    this.stopHealth();
    this.lost = null;
  }

  async unmute(): Promise<void> {
    await this.probe?.unmuteSystem();
    await this.lookAtHealth();
  }

  private scheduleHealth(ms: number): void {
    if (!this.probe || this.disposed) return;
    this.healthTimer = setTimeout(() => {
      void this.lookAtHealth().finally(() => {
        if (this.healthTimer && this.host.status() === "playing") this.scheduleHealth(HEALTH_EVERY_MS);
      });
    }, ms);
  }

  private stopHealth(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = null;
    this.stoppedLooks = 0;
    this.setSilent(undefined);
  }

  private async lookAtHealth(): Promise<void> {
    if (!this.probe || this.disposed) return;
    const state = this.probe.contextState();
    this.stoppedLooks = state !== null && state !== "running" ? this.stoppedLooks + 1 : 0;
    let cause: SilentCause | undefined = this.stoppedLooks >= 2 ? "output_stopped" : undefined;
    if (!cause && (await this.probe.systemMuted().catch(() => null))) cause = "system_muted";
    if (this.disposed || this.host.status() !== "playing") return;
    this.setSilent(cause);
  }

  private setSilent(cause: SilentCause | undefined): void {
    if (cause === this.silent) return;
    this.silent = cause;
    this.publish();
  }

  async choose(id: string | null): Promise<void> {
    const device = id ? this.devices.find((d) => d.deviceId === id) : undefined;
    if (id && !device) return;
    this.chosen = id && device ? { id, label: device.label } : null;
    this.fellBack = false;
    this.lost = null;
    this.host.remember(this.chosen);
    await this.apply(this.chosen?.id ?? "");
    this.capture();
    this.publish();
  }

  private async apply(id: string): Promise<void> {
    this.error = undefined;
    try {
      for (const sink of this.sinks()) await sink.setSinkId(id);
      this.applied = id;
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (id !== "" && (name === "NotFoundError" || name === "NotAllowedError")) {
        this.error = name;
        for (const sink of this.sinks()) await sink.setSinkId("").catch(() => undefined);
        this.applied = "";
        return;
      }
      throw error;
    }
  }

  private physical(): Physical | null {
    const outputs = this.devices.filter((d) => d.kind === "audiooutput");
    if (this.applied) {
      const device = outputs.find((d) => d.deviceId === this.applied);
      return device ? { groupId: device.groupId, label: device.label } : null;
    }
    const fallback = outputs.find((d) => d.deviceId === "default");
    if (!fallback) return null;
    const behind = outputs.find((d) => d.deviceId !== "default" && d.groupId === fallback.groupId);
    return { groupId: fallback.groupId, label: behind?.label ?? fallback.label };
  }

  private capture(): void {
    this.active = this.physical();
  }

  private scheduleCheck(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.doCheck();
    }, DEVICE_DEBOUNCE_MS);
  }

  private async doCheck(): Promise<void> {
    if (this.checkRunning) {
      this.checkQueued = true;
      return;
    }
    this.checkRunning = true;
    try {
      await this.check();
      if (this.checkQueued) {
        this.checkQueued = false;
        await this.doCheck();
      }
    } finally {
      this.checkRunning = false;
    }
  }

  private async check(): Promise<void> {
    if (this.disposed) return;
    this.devices = await this.media.enumerateDevices();
    const outputs = this.devices.filter((d) => d.kind === "audiooutput");
    const present = (p: Physical) => outputs.some((d) => d.groupId === p.groupId);
    const returning = (p: Physical) => outputs.find((d) => d.deviceId !== "default" && (d.groupId === p.groupId || d.label === p.label));

    if (this.chosen) {
      const back = outputs.find((d) => d.deviceId === this.chosen!.id) ?? outputs.find((d) => d.label === this.chosen!.label && d.deviceId !== "default");
      if (back && this.fellBack) {
        this.fellBack = false;
        try {
          await this.apply(back.deviceId);
        } catch {
          // apply handles known errors; rethrows are fatal and must not become unhandled
        }
      } else if (!back && !this.fellBack) {
        this.fellBack = true;
        try {
          await this.apply("");
        } catch {
          // apply handles known errors; rethrows are fatal and must not become unhandled
        }
      }
    }

    if (this.lost) {
      const back = returning(this.lost);
      if (back && this.now() - this.lost.at <= AUTO_RESUME_MS && this.host.status() === "paused") {
        if (this.chosen && back.deviceId !== this.applied) {
          try {
            await this.apply(back.deviceId);
          } catch {
            // apply handles known errors; rethrows are fatal and must not become unhandled
          }
        }
        this.lost = null;
        this.capture();
        this.publish();
        this.host.resume();
        return;
      }
      if (this.now() - this.lost.at > AUTO_RESUME_MS) this.lost = null;
    }

    const active = this.active;
    if (active && !present(active) && this.host.status() === "playing" && this.host.pauseOnDeviceLoss()) {
      this.lost = { ...active, at: this.now() };
      this.host.pauseForDeviceLoss();
    }
    this.capture();
    this.publish();
  }

  private publish(): void {
    const device = this.applied ? this.devices.find((d) => d.deviceId === this.applied) : undefined;
    const active = device ? { id: device.deviceId, label: device.label } : SYSTEM_DEFAULT;
    this.host.setOutput({
      chosen: this.chosen,
      active,
      fellBack: this.fellBack,
      ...(this.error ? { error: this.error } : {}),
      ...(this.silent ? { silent: this.silent } : {}),
    });
  }
}
