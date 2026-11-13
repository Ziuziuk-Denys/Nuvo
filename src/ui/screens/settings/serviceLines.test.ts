import { describe, expect, it } from "vitest";
import en from "../../../i18n/locales/en.json";
import ru from "../../../i18n/locales/ru.json";
import type { ServiceCheck } from "../../ports/system";
import { serviceLine, serviceLines } from "./serviceLines";

type Tree = { [key: string]: string | Tree };

function translator(locale: Tree) {
  return (key: string, vars?: Record<string, unknown>) => {
    const text = key.split(".").reduce<string | Tree>((node, part) => (node as Tree)[part], locale) as string;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name]));
  };
}

const line = (check: ServiceCheck, proxied = false, locale: Tree = en) => serviceLine(check, proxied, translator(locale));

describe("serviceLine", () => {
  it("a working service shows its latency and no advice", () => {
    expect(line({ service: "YouTube", state: "works", ms: 182 })).toEqual({ name: "YouTube", status: "Works · 182 ms", advice: null });
    expect(line({ service: "Lyrics", state: "slow", ms: 2400 }, false, ru).status).toBe("Медленно · 2400 мс");
  });

  it("a blocked service says what to do, depending on whether a proxy is already set", () => {
    expect(line({ service: "YouTube", state: "blocked", ms: 5000 })).toEqual({
      name: "YouTube",
      status: "Blocked",
      advice: "Blocked on this network: turn on a VPN or set a proxy above.",
    });
    expect(line({ service: "YouTube", state: "blocked", ms: 5000 }, true).advice).toBe("Blocked even through the proxy: try another proxy or VPN server.");
  });

  it("names services in the reader's language and blames the right side", () => {
    expect(line({ service: "Updates", state: "proxy_error", ms: 30 }, true, ru)).toEqual({
      name: "Обновления",
      status: "Ошибка прокси",
      advice: "Прокси не пропустил запрос: проверьте адрес, имя пользователя и пароль выше.",
    });
    expect(line({ service: "Recognition", state: "down", ms: 80 })).toMatchObject({ status: "Down", advice: "The problem is on their side. Try again later." });
    expect(line({ service: "Tools", state: "offline", ms: 0 })).toEqual({ name: "Tool downloads", status: "No network", advice: null });
  });
});

describe("serviceLines", () => {
  it("one advice for a run of services with the same problem, after the last of them", () => {
    const checks: ServiceCheck[] = [
      { service: "YouTube", state: "blocked", ms: 5000 },
      { service: "SoundCloud", state: "blocked", ms: 5000 },
      { service: "Lyrics", state: "works", ms: 90 },
      { service: "Updates", state: "blocked", ms: 5000 },
    ];
    const blocked = "Blocked on this network: turn on a VPN or set a proxy above.";
    expect(serviceLines(checks, false, translator(en)).map((one) => one.advice)).toEqual([null, blocked, null, blocked]);
  });
});
