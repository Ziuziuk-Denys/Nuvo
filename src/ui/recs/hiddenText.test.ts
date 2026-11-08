import { describe, expect, it } from "vitest";
import type { TFunction } from "../ports/i18n";
import type { Suppression } from "../ports/recs";
import { hiddenLine, hiddenTitle } from "./hiddenText";

const t = ((key: string, values?: Record<string, unknown>) => (values ? `${key}|${values.count}` : key)) as unknown as TFunction;
const DAY = 86_400_000;
const NOW = 1_000 * DAY;
const track = { id: "a", title: "Roygbiv", artists: "Boards of Canada", artistList: [{ id: "b", name: "Boards of Canada" }], coverUrl: "", durationMs: 1 };
const item = (scope: Suppression["scope"], fadesAt: number | null): Suppression => ({ id: 1, scope, origin: "user", track, fadesAt });

describe("hidden list text", () => {
  it("names the track, or the artist for artist scopes", () => {
    expect(hiddenTitle(item("work", null), t)).toBe("Roygbiv");
    expect(hiddenTitle(item("artist_forever", null), t)).toBe("Boards of Canada");
    expect(hiddenTitle({ ...item("exact", null), track: null }, t)).toBe("ui.recs.hidden.unknown");
  });

  it("says how long in whole months, at least one, never a date", () => {
    expect(hiddenLine(item("work", NOW + 100 * DAY), NOW, t)).toBe("ui.recs.hidden.scope_work · ui.recs.hidden.fades|4");
    expect(hiddenLine(item("exact", NOW + DAY), NOW, t)).toBe("ui.recs.hidden.scope_exact · ui.recs.hidden.fades|1");
    expect(hiddenLine(item("artist_forever", null), NOW, t)).toBe("ui.recs.hidden.scope_artist_forever · ui.recs.hidden.always");
  });
});
