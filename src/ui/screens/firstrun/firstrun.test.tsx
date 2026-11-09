// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useTour } from "../../tour/tourStore";
import { DONE_KEY } from "./firstRunModel";
import { FirstRun } from "./FirstRun";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), save: vi.fn(), copy: vi.fn() }));

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key) }),
}));
vi.mock("../../ports/core", () => ({ coreApi: { confirmPhrase: mocks.confirm } }));
vi.mock("../../ports/system", () => ({ saveTextFile: mocks.save }));

const WORDS = Array.from({ length: 24 }, (_, index) => `word${index + 1}`);

let root: Root;
let host: HTMLDivElement;
let onDone: ReturnType<typeof vi.fn<() => void>>;

function mount(words: string[] | null) {
  act(() => root.render(<FirstRun words={words} onDone={onDone} />));
}

const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label);
const words = () => host.querySelectorAll("[data-testid=recovery-word]");

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  useTour.setState({ ...useTour.getInitialState() });
  onDone = vi.fn<() => void>();
  mocks.confirm.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(true);
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mocks.copy }, configurable: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("FirstRun", () => {
  it("shows the 24 words first, with copy and save and no way past them but confirming", () => {
    mount(WORDS);
    expect(words()).toHaveLength(24);
    expect(words()[23].textContent).toContain("24");
    expect([...host.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["core.phrase_copy", "core.phrase_save", "core.phrase_confirm"]);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(words()).toHaveLength(24);
    expect(useTour.getState().phase).toBe("off");
  });

  it("copies and saves the numbered words", async () => {
    mount(WORDS);
    act(() => button("core.phrase_copy")!.click());
    await settle();
    expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining("1. word1\n2. word2\n"));
    expect(button("core.phrase_copied")).toBeDefined();
    act(() => button("core.phrase_save")!.click());
    await settle();
    expect(mocks.save).toHaveBeenCalledWith("core.phrase_file", expect.stringContaining("24. word24\n"));
    expect(button("core.phrase_saved")).toBeDefined();
  });

  it("says so when the copy or the save fails, and stays on the words", async () => {
    mocks.copy.mockRejectedValueOnce(new Error("denied"));
    mount(WORDS);
    act(() => button("core.phrase_copy")!.click());
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("core.phrase_copy_failed");
    mocks.save.mockRejectedValueOnce(new Error("disk"));
    act(() => button("core.phrase_save")!.click());
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("core.phrase_save_failed");
    expect(words()).toHaveLength(24);
  });

  it("confirms the phrase, opens the pages and starts the tour over them", async () => {
    mount(WORDS);
    act(() => button("core.phrase_confirm")!.click());
    await settle();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    expect(onDone).toHaveBeenCalledOnce();
    expect(useTour.getState()).toMatchObject({ phase: "poster", poster: "start" });
  });

  it("stays on the phrase and says so when the confirm call fails", async () => {
    mocks.confirm.mockRejectedValueOnce(new Error("down"));
    mount(WORDS);
    act(() => button("core.phrase_confirm")!.click());
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("core.confirm_failed");
    expect(words()).toHaveLength(24);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("has no badge or glyph over the title", () => {
    mount(WORDS);
    expect(host.querySelector("header svg")).toBeNull();
  });

  it("with no phrase to confirm goes straight to the pages and the tour, once", () => {
    mount(null);
    mount(null);
    expect(onDone).toHaveBeenCalledOnce();
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    expect(useTour.getState().phase).toBe("poster");
  });
});
