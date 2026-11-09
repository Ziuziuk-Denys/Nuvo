import en from "./locales/en.json";
import type { Texts } from "./text";

export interface LocaleSources {
  en: () => Texts;
  ru: () => Promise<Texts>;
}

export const localeSources: LocaleSources = {
  en: () => en,
  ru: async () => (await import("./locales/ru.json")).default,
};
