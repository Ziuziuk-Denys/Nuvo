import { describe, expect, it } from "vitest";
import type { TFunction } from "../ports/i18n";
import { reasonText } from "./reasonText";

const t = ((key: string, values?: Record<string, string>) => (values ? `${key}|${values.name}` : key)) as unknown as TFunction;

describe("reasonText", () => {
  it("words each kind the daemon sends", () => {
    expect(reasonText({ kind: "session", name: "Roygbiv" }, t)).toBe("ui.recs.reason.session|Roygbiv");
    expect(reasonText({ kind: "similar", name: "Roygbiv" }, t)).toBe("ui.recs.reason.similar|Roygbiv");
    expect(reasonText({ kind: "artist", name: "Bonobo" }, t)).toBe("ui.recs.reason.artist|Bonobo");
    expect(reasonText({ kind: "time" }, t)).toBe("ui.recs.reason.time");
    expect(reasonText({ kind: "new" }, t)).toBe("ui.recs.reason.new");
  });

  it("says nothing rather than half a sentence", () => {
    expect(reasonText(null, t)).toBeNull();
    expect(reasonText({ kind: "similar" }, t)).toBeNull();
    expect(reasonText({ kind: "comeback", name: "x" }, t)).toBeNull();
  });
});
