import { describe, expect, it, vi } from "vitest";
import { ensureTranslator, NoTranslatorError, translateLines } from "./stream";
import { targetLanguage, textLines } from "./translation";

describe("translation helpers", () => {
  it("keeps the words of each line without stamps, word tags, section tags or empty lines", () => {
    expect(textLines({ format: "lrc", content: "[00:01.00] <00:01.00>One <00:01.50>two\n[00:03.00]\n[Chorus]\nThree" })).toEqual(["One two", "Three"]);
  });

  it("translates Russian lyrics into English and everything else into Russian", () => {
    expect(targetLanguage(["Привет, мир", "ok"])).toBe("English");
    expect(targetLanguage(["Hello world"])).toBe("Russian");
  });

  it("posts only the language and the lines to the daemon and returns its lines", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ lines: ["Привет"] }), { status: 200 }));
    const request = { lang: "Russian", lines: ["Hello"] };
    expect(await translateLines(fetcher, request)).toEqual(["Привет"]);
    expect(fetcher).toHaveBeenCalledWith("nuvo-core://local/v1/lyrics/translate", expect.objectContaining({ method: "POST", body: JSON.stringify(request) }));
  });

  it("tells a missing local model apart from other failures", async () => {
    const request = { lang: "Russian", lines: ["a"] };
    await expect(translateLines(async () => new Response("{}", { status: 409 }), request)).rejects.toBeInstanceOf(NoTranslatorError);
    await expect(translateLines(async () => new Response("{}", { status: 502 }), request)).rejects.not.toBeInstanceOf(NoTranslatorError);
  });

  it("sets the default local model only when none is stored", async () => {
    const defaults = { endpoint: "http://127.0.0.1:1234", model: "local-model" };
    const empty = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ endpoint: null, model: null }), { status: 200 }),
    );
    await ensureTranslator(empty, defaults);
    expect(empty).toHaveBeenLastCalledWith(
      "nuvo-core://local/v1/lyrics/translator",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(defaults) }),
    );

    const set = vi.fn(async () => new Response(JSON.stringify({ endpoint: "http://127.0.0.1:11434", model: "m" }), { status: 200 }));
    await ensureTranslator(set, defaults);
    expect(set).toHaveBeenCalledTimes(1);
  });
});
