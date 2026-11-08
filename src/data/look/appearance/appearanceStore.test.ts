import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_APPEARANCE } from "@/data/look/appearanceContracts";
import { useAppearanceStore } from "./appearanceStore";

const coreRequest = vi.hoisted(() => vi.fn());
vi.mock("@/data/core/request", () => ({ coreRequest }));

const locked = Object.assign(new Error("library is locked"), { status: 423 });

beforeEach(() => {
  vi.clearAllMocks();
  useAppearanceStore.setState({ saved: DEFAULT_APPEARANCE, loaded: false, safe: false, draft: null });
  (window as unknown as { nuvoShell: unknown }).nuvoShell = {
    getMainSettings: async () => ({ appearance: { safe: true, failedStarts: 0 } }),
    setMainSetting: async () => ({ ok: true }),
  };
});

describe("appearance store", () => {
  it("a locked library at start keeps the defaults and still reads safe mode; the next load after unlock applies", async () => {
    coreRequest.mockRejectedValueOnce(locked);
    await useAppearanceStore.getState().load();
    expect(useAppearanceStore.getState()).toMatchObject({ saved: DEFAULT_APPEARANCE, loaded: false, safe: true });
    const saved = { ...DEFAULT_APPEARANCE, active: { presetId: "vinyl" } };
    coreRequest.mockResolvedValueOnce(saved);
    await useAppearanceStore.getState().load();
    expect(useAppearanceStore.getState()).toMatchObject({ saved, loaded: true });
  });

  it("a refused save reports false and keeps what was saved", async () => {
    coreRequest.mockRejectedValueOnce(locked);
    expect(await useAppearanceStore.getState().save({ active: { presetId: "orbit" } })).toBe(false);
    expect(useAppearanceStore.getState().saved).toBe(DEFAULT_APPEARANCE);
  });

  it("a save keeps the daemon's answer", async () => {
    const answer = { ...DEFAULT_APPEARANCE, active: { presetId: "orbit" } };
    coreRequest.mockResolvedValueOnce(answer);
    expect(await useAppearanceStore.getState().save({ active: { presetId: "orbit" } })).toBe(true);
    expect(useAppearanceStore.getState().saved).toBe(answer);
  });

  it("without the V3 shell (old main) safe mode reads as off", async () => {
    (window as unknown as { nuvoShell?: unknown }).nuvoShell = undefined;
    coreRequest.mockResolvedValueOnce(DEFAULT_APPEARANCE);
    await useAppearanceStore.getState().load();
    expect(useAppearanceStore.getState().safe).toBe(false);
  });

  it("safe mode is switched in main first and only then in the store", async () => {
    const setMainSetting = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    (window as unknown as { nuvoShell: unknown }).nuvoShell = { setMainSetting };
    await useAppearanceStore.getState().setSafe(true);
    expect(useAppearanceStore.getState().safe).toBe(false);
    await useAppearanceStore.getState().setSafe(true);
    expect(setMainSetting).toHaveBeenLastCalledWith("appearance", { safe: true });
    expect(useAppearanceStore.getState().safe).toBe(true);
  });
});
