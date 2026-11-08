// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DONATE_URL } from "./donate";
import { DonateLink } from "./DonateLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("DonateLink", () => {
  it("is not rendered while no destination is set", async () => {
    expect(DONATE_URL).toBe("");
    await act(async () => root.render(<DonateLink />));
    expect(host.querySelector("button")).toBeNull();
  });

  it("opens the destination in the browser without opener access", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await act(async () => root.render(<DonateLink url="https://example.com/support" />));
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("ui.settings.support");
    await act(async () => button?.click());
    expect(open).toHaveBeenCalledWith("https://example.com/support", "_blank", "noopener,noreferrer");
  });
});
