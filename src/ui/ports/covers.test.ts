import { describe, expect, it } from "vitest";
import { mixCardColors } from "@/data/covers/colors";
import { useCoverSrc } from "./covers";

describe("covers port", () => {
  it("useCoverSrc asks the daemon for the 512 bucket unless a size is given, and passes nothing through", () => {
    expect(useCoverSrc("https://img/a.jpg")).toBe("nuvo-core://local/v1/covers?src=https%3A%2F%2Fimg%2Fa.jpg&size=512");
    expect(useCoverSrc("https://img/a.jpg", 64)).toBe("nuvo-core://local/v1/covers?src=https%3A%2F%2Fimg%2Fa.jpg&size=64");
    expect(useCoverSrc(undefined)).toBeUndefined();
    expect(useCoverSrc("")).toBeUndefined();
  });

  it("the mix card shade takes the darker colour; the mark the bright hue, or white when that hue is too dark", () => {
    expect(mixCardColors({ color1: "rgb(10, 20, 30)", color2: "rgb(250, 200, 40)" })).toEqual({ color1: "rgb(10, 20, 30)", logoColor: "rgb(250, 200, 40)" });
    expect(mixCardColors({ color1: "rgb(10, 20, 30)", color2: "rgb(40, 10, 60)" })).toEqual({ color1: "rgb(10, 20, 30)", logoColor: "#fff" });
  });
});
