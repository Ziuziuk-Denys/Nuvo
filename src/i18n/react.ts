import { useSyncExternalStore } from "react";
import { currentLocale, i18nVersion, isLocaleLoading, setLocale, subscribeI18n, translate, type Locale, type TFunction } from "./runtime";

export interface Translation {
  locale: Locale;
  t: TFunction;
  setLocale: (code: string) => Promise<void>;
  loading: boolean;
}

let cachedVersion = -1;
let cachedT: TFunction = translate;

/** A new function per runtime version, so memoised children that take `t` re-render when the language changes. */
function translatorFor(version: number): TFunction {
  if (version !== cachedVersion) {
    cachedVersion = version;
    cachedT = (key, vars) => translate(key, vars);
  }
  return cachedT;
}

export function useTranslation(): Translation {
  const version = useSyncExternalStore(subscribeI18n, i18nVersion, i18nVersion);
  return { locale: currentLocale(), t: translatorFor(version), setLocale, loading: isLocaleLoading() };
}
