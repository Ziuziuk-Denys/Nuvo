import { describe, expect, it } from "vitest";
import type { NetCheck } from "../ports/system";
import { adviceFor, checkHeadline } from "./connectionAdvice";

const check = (code?: string, service?: string): NetCheck => ({ checkedAt: "", rows: [], services: [], summary: "", code, service });

describe("adviceFor", () => {
  it("offline, a dead proxy, interception and the clock speak for themselves", () => {
    for (const code of ["offline", "proxy_failed", "tls_intercepted", "clock"]) expect(adviceFor(check(code), null)).toBe(code);
  });

  it("YouTube unreachable is blocked, whatever playback saw", () => {
    for (const code of ["blocked", "dns_failed", "timeout"]) expect(adviceFor(check(code, "YouTube"), "timeout")).toBe("blocked");
  });

  it("reachable YouTube with refused streams is a refusal of this address", () => {
    expect(adviceFor(check(), "http_403")).toBe("refused");
    expect(adviceFor(check(), "blocked")).toBe("refused");
  });

  it("stays silent when nothing is wrong or the trouble is elsewhere", () => {
    expect(adviceFor(check(), null)).toBeNull();
    expect(adviceFor(check(), "timeout")).toBeNull();
    expect(adviceFor(check("blocked", "Lyrics"), null)).toBeNull();
  });
});

describe("checkHeadline", () => {
  it("says what to do when YouTube is blocked or the proxy is down", () => {
    expect(checkHeadline(check("blocked", "YouTube"))).toEqual({ key: "ui.network_advice.blocked" });
    expect(checkHeadline(check("proxy_failed"))).toEqual({ key: "ui.network_advice.proxy_failed" });
  });

  it("names a service in trouble and says when all is well", () => {
    expect(checkHeadline(check("server_error", "Lyrics"))).toEqual({ key: "ui.settings.check_service", vars: { service: "Lyrics" } });
    expect(checkHeadline(check())).toEqual({ key: "ui.settings.check_clear" });
  });
});
