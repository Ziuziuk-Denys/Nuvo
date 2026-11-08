// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { usePageBackdropStore } from "../ports/backdrop";
import { useCustomizationStore } from "../ports/settings";
import type { PresetId, PresetMode } from "../ports/theme";
import { useCalmLight } from "./calm";
import { Field } from "./Field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const look = vi.hoisted(() => ({ current: { preset: "nuvo" as PresetId, mode: "dark" as PresetMode } }));

vi.mock("../ports/covers", () => ({ useCoverSrc: (url: string | undefined) => url }));
vi.mock("../ports/theme", () => ({ useLook: () => look.current }));

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
  usePageBackdropStore.setState({ coverUrl: undefined, options: undefined });
  useCustomizationStore.setState({ backgroundImage: null, coverGlow: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Field", () => {
  it("is a plain canvas without a page cover and hides from assistive tech", () => {
    mount(<Field />);
    expect(host.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(covers()).toEqual([]);
  });

  it("shows the page cover blurred and keeps at most two covers through rapid changes", () => {
    mount(<Field />);
    act(() => usePageBackdropStore.setState({ coverUrl: "c1.jpg" }));
    expect(covers()).toEqual(["c1.jpg"]);
    expect(host.querySelector("img")!.style.filter).toBe("blur(32px) saturate(130%)");
    act(() => {
      for (let i = 2; i <= 10; i += 1) usePageBackdropStore.setState({ coverUrl: `c${i}.jpg` });
    });
    expect(covers().length).toBeLessThanOrEqual(2);
    expect(covers().at(-1)).toBe("c10.jpg");
  });

  it("leaves the canvas plain while cover glow is off or a calm screen is mounted", () => {
    usePageBackdropStore.setState({ coverUrl: "c1.jpg" });
    useCustomizationStore.setState({ coverGlow: false });
    mount(<Field />);
    expect(covers()).toEqual([]);
    useCustomizationStore.setState({ coverGlow: true });
    mount(
      <>
        <Calm />
        <Field />
      </>,
    );
    expect(covers()).toEqual([]);
  });

  it("shows the wallpaper instead of the cover in dark mode", () => {
    useCustomizationStore.setState({ backgroundImage: "data:image/png;base64,AAAA", backgroundBlur: 8, backgroundDim: 30 });
    mount(<Field />);
    expect(covers()).toEqual(["data:image/png;base64,AAAA"]);
    expect(host.querySelector("img")!.style.filter).toBe("blur(8px)");
  });
});
