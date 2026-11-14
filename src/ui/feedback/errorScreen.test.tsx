// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { report } from "./ErrorScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/feedback", () => ({ logError: vi.fn(), APP_VERSION: "1.2.3", recentLog: () => ["12:00 warn library index slow"] }));
vi.mock("../shell/WindowButtons", () => ({ WindowButtons: () => <div data-window-controls /> }));
vi.mock("../ports/escape", () => ({ isEscapeGuarded: () => false }));

function Broken(): never {
  throw new Error("cover decoder fell over");
}

let root: Root;
let host: HTMLDivElement;
const writeText = vi.fn();

const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label)!;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders its children while nothing throws", () => {
    act(() =>
      root.render(
        <ErrorBoundary>
          <p data-page>Home</p>
        </ErrorBoundary>,
      ),
    );
    expect(host.querySelector("[data-page]")).not.toBeNull();
  });

  it("replaces a thrown tree with an alert dialog that names the problem and keeps the details folded", () => {
    act(() =>
      root.render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      ),
    );
    const card = document.querySelector<HTMLElement>("[role=alertdialog]")!;
    expect(card.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(card.getAttribute("aria-labelledby")!)?.textContent).toBe("ui.error.title");
    expect(document.getElementById(card.getAttribute("aria-describedby")!)?.textContent).toBe("ui.error.line");
    const toggle = button("ui.error.details");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector("pre")).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.querySelector("pre")?.textContent).toContain("cover decoder fell over");
    expect(document.querySelector("[data-window-controls]")).not.toBeNull();
  });

  it("puts focus on Reload and keeps Tab inside the card", () => {
    act(() =>
      root.render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      ),
    );
    const reload = button("ui.error.reload");
    expect(document.activeElement).toBe(reload);
    const toggle = button("ui.error.details");
    toggle.focus();
    act(() => {
      toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(reload);
  });

  it("copies the details with the stack", async () => {
    act(() =>
      root.render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      ),
    );
    act(() => button("ui.error.details").click());
    await act(async () => button("ui.error.copy").click());
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Error: cover decoder fell over");
    expect(copied).toContain("Broken");
    expect(copied).toContain("1.2.3");
    expect(copied).toContain("Log:\n12:00 warn library index slow");
    expect(button("ui.error.copied")).toBeDefined();
  });

  it("keeps the file name and line of a stack frame but not the folders around it", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at kv (file:///home/ann/apps/nuvo/dist/assets/App-C3.js:13:6942)";
    const text = report(error, null, ["warn pins could not read /home/ann/Music/a.flac"]);
    expect(text).toContain("at kv (App-C3.js:13:6942)");
    expect(text).toContain("could not read ~/Music/a.flac");
    expect(text).not.toContain("ann");
  });

  it("reloads the window", () => {
    const reload = vi.fn();
    act(() =>
      root.render(
        <ErrorBoundary onReload={reload}>
          <Broken />
        </ErrorBoundary>,
      ),
    );
    act(() => button("ui.error.reload").click());
    expect(reload).toHaveBeenCalledOnce();
  });
});
