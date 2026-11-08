// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { DONE_KEY } from "../firstrun/firstRunModel";
import { Gate } from "./Gate";
import { useGateStore } from "./gateState";
import { LockScreen } from "./LockScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  status: "ready" as string,
  health: vi.fn(),
  phrase: vi.fn(),
  empty: vi.fn(),
  restore: vi.fn(),
  passphrase: vi.fn(),
  reduced: false,
}));

vi.mock("../../ports/escape", () => ({ isEscapeGuarded: () => false }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }),
}));
vi.mock("../../ports/core", () => ({
  useCoreStatus: () => mocks.status,
  coreApi: {
    health: mocks.health,
    recoveryPhrase: mocks.phrase,
    isLibraryEmpty: mocks.empty,
    restore: mocks.restore,
    unlockWithPassphrase: mocks.passphrase,
    confirmPhrase: vi.fn(),
  },
}));
vi.mock("../../shell/WindowButtons", () => ({ WindowButtons: () => <div data-window-controls /> }));
vi.mock("../firstrun/FirstRun", () => ({
  FirstRun: ({ words }: { words: string[] | null }) => <h1 data-first-run>{words ? words.length : "none"}</h1>,
}));

const PHRASE = Array.from({ length: 24 }, (_, index) => `w${index}`).join(" ");

let root: Root;
let host: HTMLDivElement;
const animate = vi.fn();

const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label)!;
const field = () => document.querySelector("textarea")!;
const dialog = () => document.querySelector<HTMLElement>("[role=dialog]");

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  mocks.status = "ready";
  mocks.reduced = false;
  mocks.health.mockResolvedValue({ status: "ok", locked: false });
  mocks.phrase.mockRejectedValue(Object.assign(new Error("gone"), { status: 404 }));
  mocks.empty.mockResolvedValue(false);
  mocks.restore.mockResolvedValue(undefined);
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce") && mocks.reduced })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  useGateStore.setState({ locked: false });
  vi.clearAllMocks();
});

describe("LockScreen with a sealed key file", () => {
  const input = () => document.querySelector<HTMLInputElement>('input[type="password"]')!;
  const typeIn = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("asks for the passphrase instead of the phrase and unlocks with it", async () => {
    mocks.passphrase.mockResolvedValue(undefined);
    const onUnlocked = vi.fn();
    act(() => root.render(<LockScreen passphrase onUnlocked={onUnlocked} />));
    expect(document.querySelector("textarea")).toBeNull();
    typeIn("correct horse");
    await act(async () => button("ui.lock.unlock").click());
    expect(mocks.passphrase).toHaveBeenCalledWith("correct horse");
    expect(onUnlocked).toHaveBeenCalled();
  });

  it("says so calmly when the passphrase is wrong", async () => {
    mocks.passphrase.mockRejectedValue(Object.assign(new Error("bad"), { status: 400 }));
    act(() => root.render(<LockScreen passphrase onUnlocked={vi.fn()} />));
    typeIn("nope nope nope");
    await act(async () => button("ui.lock.unlock").click());
    expect(document.querySelector("[role=alert]")?.textContent).toBe("ui.lock.wrong_passphrase");
  });

  it("the gate shows the passphrase form when the daemon says the file is sealed", async () => {
    mocks.health.mockResolvedValue({ status: "ok", locked: true, passphrase: true });
    act(() => root.render(<Gate>pages</Gate>));
    await settle();
    expect(input()).not.toBeNull();
  });
});

describe("LockScreen", () => {
  it("is a modal dialog named by its title and described by its line", () => {
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    const card = dialog()!;
    expect(card.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(card.getAttribute("aria-labelledby")!)?.textContent).toBe("ui.lock.title");
    expect(document.getElementById(card.getAttribute("aria-describedby")!)?.textContent).toBe("ui.lock.line");
    // the window stays movable and closable while the card is up
    expect(document.querySelector("[data-window-controls]")).not.toBeNull();
  });

  it("puts focus in the phrase field and keeps Tab inside the card", () => {
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    expect(document.activeElement).toBe(field());
    const last = button("ui.lock.lost");
    last.focus();
    press(last, "Tab");
    expect(document.activeElement).toBe(field());
    press(field(), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("cannot be dismissed with Escape", () => {
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    press(field(), "Escape");
    expect(dialog()).not.toBeNull();
  });

  it("counts the words and keeps Unlock disabled until there are 24", () => {
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    expect(button("ui.lock.unlock").disabled).toBe(true);
    type("one two three");
    expect(document.body.textContent).toContain('ui.lock.count:{"count":3}');
    expect(button("ui.lock.unlock").disabled).toBe(true);
    type(`  ${PHRASE.toUpperCase()}  `);
    expect(document.body.textContent).toContain('ui.lock.count:{"count":24}');
    expect(button("ui.lock.unlock").disabled).toBe(false);
  });

  it("restores with the normalised phrase, shows it is busy, and reports success", async () => {
    let finish = () => undefined as void;
    mocks.restore.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    const onUnlocked = vi.fn();
    act(() => root.render(<LockScreen onUnlocked={onUnlocked} />));
    type(PHRASE.replace(/ /g, "\n  ").toUpperCase());
    act(() => button("ui.lock.unlock").click());
    expect(mocks.restore).toHaveBeenCalledWith(PHRASE);
    expect(button("ui.lock.unlocking").disabled).toBe(true);
    expect(dialog()?.getAttribute("aria-busy")).toBe("true");
    finish();
    await settle();
    expect(onUnlocked).toHaveBeenCalledOnce();
  });

  it("unlocks with Enter once the phrase is complete and never inserts a line break", async () => {
    const onUnlocked = vi.fn();
    act(() => root.render(<LockScreen onUnlocked={onUnlocked} />));
    type("one two");
    expect(press(field(), "Enter").defaultPrevented).toBe(true);
    expect(mocks.restore).not.toHaveBeenCalled();
    type(PHRASE);
    press(field(), "Enter");
    await settle();
    expect(mocks.restore).toHaveBeenCalledWith(PHRASE);
    expect(onUnlocked).toHaveBeenCalledOnce();
  });

  it("answers a wrong phrase with a shake and an alert tied to the field, and keeps the words", async () => {
    mocks.restore.mockRejectedValueOnce(Object.assign(new Error("bad"), { status: 400 }));
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    type(PHRASE);
    act(() => button("ui.lock.unlock").click());
    await settle();
    const alert = document.querySelector("[role=alert]")!;
    expect(alert.textContent).toBe("ui.lock.wrong");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toContain(alert.id);
    expect(field().value).toBe(PHRASE);
    expect(document.activeElement).toBe(field());
    expect(animate).toHaveBeenCalledOnce();
    expect(button("ui.lock.unlock").disabled).toBe(false);
    // typing again takes the complaint back
    type(`${PHRASE} `);
    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  it("does not shake under reduced motion", async () => {
    mocks.reduced = true;
    mocks.restore.mockRejectedValueOnce(Object.assign(new Error("bad"), { status: 400 }));
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    type(PHRASE);
    act(() => button("ui.lock.unlock").click());
    await settle();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("ui.lock.wrong");
    expect(animate).not.toHaveBeenCalled();
  });

  it("calls any other failure a network problem", async () => {
    mocks.restore.mockRejectedValueOnce(new Error("socket"));
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    type(PHRASE);
    act(() => button("ui.lock.unlock").click());
    await settle();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("common.error_network");
  });

  it("explains a lost phrase in place, as a disclosure", () => {
    act(() => root.render(<LockScreen onUnlocked={vi.fn()} />));
    const toggle = button("ui.lock.lost");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("ui.lock.lost_text");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.textContent).toBe("ui.lock.lost_text");
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
  });
});

describe("Gate", () => {
  it("opens an existing profile straight away and never mounts the first run", async () => {
    act(() =>
      root.render(
        <Gate>
          <p data-page>Home</p>
        </Gate>,
      ),
    );
    await settle();
    expect(host.querySelector("[data-page]")).not.toBeNull();
    expect(host.querySelector("[data-first-run]")).toBeNull();
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
  });

  it("shows the first run with the phrase on a fresh profile", async () => {
    mocks.phrase.mockResolvedValue(PHRASE);
    mocks.empty.mockResolvedValue(true);
    act(() =>
      root.render(
        <Gate>
          <p data-page>Home</p>
        </Gate>,
      ),
    );
    await settle();
    expect(host.querySelector("[data-first-run]")?.textContent).toBe("24");
    expect(host.querySelector("[data-page]")).toBeNull();
  });

  it("shows the pages before the daemon is ready once the first run is done", () => {
    localStorage.setItem(DONE_KEY, "1");
    mocks.status = "starting";
    act(() =>
      root.render(
        <Gate>
          <p data-page>Home</p>
        </Gate>,
      ),
    );
    expect(host.querySelector("[data-page]")).not.toBeNull();
  });

  it("floats the lock card over the window while locked, then brings the pages and focus back", async () => {
    localStorage.setItem(DONE_KEY, "1");
    mocks.health.mockResolvedValue({ status: "ok", locked: true });
    const changed = vi.fn();
    window.addEventListener("library:changed", changed);
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    act(() =>
      root.render(
        <Gate>
          <p data-page>Home</p>
        </Gate>,
      ),
    );
    await settle();
    expect(host.querySelector("[data-page]")).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    // the island hides while the library is locked
    expect(useGateStore.getState().locked).toBe(true);
    type(PHRASE);
    act(() => button("ui.lock.unlock").click());
    await settle();
    expect(changed).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-page]")).not.toBeNull();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(useGateStore.getState().locked).toBe(false);
    window.removeEventListener("library:changed", changed);
  });
});
