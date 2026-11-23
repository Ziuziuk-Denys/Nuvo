// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Banner } from "./Banner";

vi.mock("../ports/covers", () => ({ useCoverSrc: (src: string, px = 512) => `${src}@${px}` }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const sources = () => [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => act(() => root.unmount()));

it("shows a small photo first and the sharp one over it", () => {
  act(() => root.render(<Banner src="wide" portrait={false} />));
  expect(sources()).toEqual(["wide@512", `wide@${window.innerWidth}`]);
  const [soon] = host.querySelectorAll("img");
  expect(soon.hasAttribute("data-shown")).toBe(false);
  act(() => void soon.dispatchEvent(new Event("load")));
  expect(soon.hasAttribute("data-shown")).toBe(true);
});

it("fills the width behind a square portrait", () => {
  act(() => root.render(<Banner src="face" portrait />));
  expect(sources()).toEqual(["face@512", "face@512", "face@640"]);
  expect(host.querySelector("[data-banner]")?.getAttribute("data-banner")).toBe("portrait");
});
