// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAsFiles } from "../../ports/exports";
import { SaveFormatRow } from "./SaveFormatRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }), getTranslationsForAllLocales: (key: string) => [key] }));
vi.mock("@/engine/index", () => ({ kickDownloads: vi.fn() }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { nuvoShell?: unknown }).nuvoShell;
});

describe("SaveFormatRow", () => {
  it("saves in the original format until MP3 is picked, then every save asks for MP3", async () => {
    const save = vi.fn(async () => ({ jobId: "j1" }));
    (window as unknown as { nuvoShell: unknown }).nuvoShell = { saveAsFiles: save };
    act(() => root.render(<SaveFormatRow />));
    const chip = (label: string) => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label)!;
    expect(chip("ui.settings.save_format.original").getAttribute("aria-pressed")).toBe("true");

    await saveAsFiles({ trackIds: ["t1"], label: "Song", playlistFile: false });
    expect(save).toHaveBeenLastCalledWith({ trackIds: ["t1"], label: "Song", playlistFile: false, format: "original" });

    act(() => chip("MP3").click());
    expect(chip("MP3").getAttribute("aria-pressed")).toBe("true");
    await saveAsFiles({ playlistId: "p1", label: "Mix", playlistFile: true });
    expect(save).toHaveBeenLastCalledWith({ playlistId: "p1", label: "Mix", playlistFile: true, format: "mp3" });
  });
});
