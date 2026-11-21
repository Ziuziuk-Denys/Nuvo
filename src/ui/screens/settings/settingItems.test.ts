import { describe, expect, it } from "vitest";
import en from "../../../i18n/locales/en.json";
import { SECTION_ORDER, SECTIONS } from "./sections";
import { SETTING_ITEMS } from "./settingItems";

function has(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

describe("settings index", () => {
  it("lists rows of every searchable section, each under a real tab with texts that exist", () => {
    expect(new Set(SETTING_ITEMS.map((item) => item.tabId))).toEqual(new Set(SECTION_ORDER.filter((id) => id !== "Shortcuts")));
    for (const item of SETTING_ITEMS) {
      expect(SECTIONS[item.tabId], item.titleKey).toBeDefined();
      expect(has(item.titleKey), item.titleKey).toBe(true);
      if (item.descKey) expect(has(item.descKey), item.descKey).toBe(true);
      if (item.findKey) expect(has(item.findKey), item.findKey).toBe(true);
    }
  });

  it("has each row once", () => {
    const keys = SETTING_ITEMS.map((item) => item.titleKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
