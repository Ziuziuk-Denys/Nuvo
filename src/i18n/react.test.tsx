import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useTranslation } from "./react";
import { i18nTesting, prepareLocale, setLocale } from "./runtime";
import type { Texts } from "./text";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EN = { app: { title: "Nuvo" }, x: { markup: "<b>{x}</b>" } };
const RU = { app: { title: "Нюво" }, x: { markup: "<b>{x}</b>" } };

function Probe() {
  const { t, locale, loading } = useTranslation();
  return (
    <p data-locale={locale} data-loading={String(loading)}>
      <span>{t("app.title")}</span>
      <em>{t("x.markup", { x: "1" })}</em>
    </p>
  );
}

let host: HTMLDivElement;
let root: Root;

function mount(): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
}

const shown = () => ({
  title: host.querySelector("span")?.textContent,
  locale: host.querySelector("p")?.dataset.locale,
  loading: host.querySelector("p")?.dataset.loading,
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("useTranslation", () => {
  it("18: markup in a translation is shown as text", () => {
    i18nTesting.reset({ sources: { en: () => EN, ru: async () => RU } });
    mount();
    expect(host.querySelector("em")?.textContent).toBe("<b>1</b>");
    expect(host.querySelector("b")).toBeNull();
  });

  it("26: loading is true while Russian loads, then everything switches in one render", async () => {
    let finish!: (texts: Texts) => void;
    const file = new Promise<Texts>((resolve) => {
      finish = resolve;
    });
    i18nTesting.reset({ sources: { en: () => EN, ru: () => file } });
    mount();
    let switching!: Promise<void>;
    act(() => {
      switching = setLocale("ru");
    });
    expect(shown()).toEqual({ title: "Nuvo", locale: "en", loading: "true" });
    await act(async () => {
      finish(RU);
      await switching;
    });
    expect(shown()).toEqual({ title: "Нюво", locale: "ru", loading: "false" });
    expect(document.documentElement.lang).toBe("ru");
  });

  it("32: works without any provider, with the persisted locale", async () => {
    localStorage.setItem("nuvo_locale", "ru");
    i18nTesting.reset({ sources: { en: () => EN, ru: async () => RU } });
    await prepareLocale();
    mount();
    expect(shown().title).toBe("Нюво");
  });
});
