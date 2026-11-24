// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { usePageBackdropStore } from "../ports/backdrop";
import { useCustomizationStore } from "../ports/settings";
import type { PresetId, PresetMode } from "../ports/theme";
import { useCalmLight } from "./calm";
import { Field } from "./Field";
import { applyWindowVisibility } from "../ports/window";
import { useEffectsStore } from "../effects";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const look = vi.hoisted(() => ({ current: { preset: "nuvo" as PresetId, mode: "dark" as PresetMode } }));

vi.mock("../ports/covers", () => ({ useCoverSrc: (url: string | undefined) => url, coverSrc: (url: string) => url }));
vi.mock("../ports/theme", () => ({ useLook: () => look.current }));
const lit = vi.hoisted(() => ({ cover: undefined as string | undefined }));
const playing = vi.hoisted(() => ({ cover: "" }));
vi.mock("../ports/player", () => ({ usePlayingCover: () => playing.cover }));
vi.mock("../light/LightCanvas", () => ({ LightCanvas: ({ scene }: { scene: string }) => <div data-light={scene} /> }));
vi.mock("../light/useCoverLight", () => ({
  useCoverLight: (cover: string | undefined) => {
    lit.cover = cover;
    return null;
  },
}));

function Calm() {
  useCalmLight();
  return null;
}

let root: Root;
let host: HTMLDivElement;

function mount(node: React.ReactNode) {
  act(() => root.render(node));
}

const covers = () => [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));

beforeEach(() => {
  look.current = { preset: "nuvo", mode: "dark" };
  usePageBackdropStore.setState({ coverUrl: null, options: {} });
  useCustomizationStore.setState({ backgroundImage: null, coverGlow: true, backgroundBlur: 10, backgroundDim: 0, backgroundFit: "cover" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  applyWindowVisibility(true);
  useEffectsStore.setState({ reduce: false });
  vi.restoreAllMocks();
});

describe("Field", () => {
  const scene = () => host.querySelector("[data-light]")?.getAttribute("data-light");

  it("lights the page in the scene it asks for, and a wall where no page asks", () => {
    playing.cover = "now.jpg";
    mount(<Field />);
    expect([scene(), lit.cover]).toEqual(["wall", "now.jpg"]);
    act(() => usePageBackdropStore.setState({ coverUrl: "c1.jpg", options: { scene: "room" } }));
    expect([scene(), lit.cover]).toEqual(["room", "c1.jpg"]);
    act(() => usePageBackdropStore.setState({ coverUrl: "album.jpg", options: {} }));
    expect([scene(), lit.cover]).toEqual(["page", "album.jpg"]);
    playing.cover = "";
  });

  it("hides from assistive tech", () => {
    mount(<Field />);
    expect(host.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });

  it("dims on a calm screen and goes out with the setting", () => {
    usePageBackdropStore.setState({ coverUrl: "c1.jpg", options: { scene: "room" } });
    mount(
      <>
        <Calm />
        <Field />
      </>,
    );
    expect(scene()).toBe("calm");
    act(() => useCustomizationStore.setState({ coverGlow: false }));
    expect([scene(), lit.cover]).toEqual([undefined, undefined]);
  });

  it("shows the wallpaper instead of the cover in both modes, washed with the theme's own ground", () => {
    usePageBackdropStore.setState({ coverUrl: "c1.jpg" });
    useCustomizationStore.setState({ backgroundImage: "data:image/png;base64,AAAA", backgroundBlur: 8, backgroundDim: 30, backgroundFit: "contain" });
    for (const mode of ["dark", "light"] as const) {
      look.current = { preset: "nuvo", mode };
      mount(<Field />);
      expect(covers()).toEqual(["data:image/png;base64,AAAA"]);
      expect(host.querySelector("img")!.style).toMatchObject({ filter: "blur(8px)", objectFit: "contain" });
      expect((host.querySelector("img")!.nextElementSibling as HTMLElement).style.opacity).toBe("0.3");
    }
  });

  it("plays a video wallpaper only while the window is shown and motion is allowed", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    useCustomizationStore.setState({ backgroundImage: "nuvo-core://local/wallpaper/0b7c63c8-1d0a-4c3e-9f55-2a8e7d1b4c11.webm" });
    mount(<Field />);
    const video = host.querySelector("video")!;
    expect([video.muted, video.loop, play.mock.calls.length]).toEqual([true, true, 1]);
    act(() => applyWindowVisibility(false));
    expect(pause).toHaveBeenCalledTimes(1);
    act(() => applyWindowVisibility(true));
    expect(play).toHaveBeenCalledTimes(2);
    act(() => useEffectsStore.setState({ reduce: true }));
    expect(pause).toHaveBeenCalledTimes(2);
    expect(host.querySelector("video")).toBe(video);
  });

  it("turns a GIF into a still while the window is hidden", () => {
    useCustomizationStore.setState({ backgroundImage: "nuvo-core://local/wallpaper/0b7c63c8-1d0a-4c3e-9f55-2a8e7d1b4c11.gif" });
    mount(<Field />);
    expect(host.querySelector("img")).not.toBeNull();
    act(() => applyWindowVisibility(false));
    expect([host.querySelector("img"), host.querySelector("canvas")?.tagName]).toEqual([null, "CANVAS"]);
    act(() => applyWindowVisibility(true));
    expect(host.querySelector("img")).not.toBeNull();
  });
});
