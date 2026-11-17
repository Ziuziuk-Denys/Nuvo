// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open = vi.hoisted(() => vi.fn());
vi.mock("../../ports/i18n", async (original) => ({ ...(await original<object>()), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../ports/system", () => ({ openExternal: open }));

import { CommunityLinks } from "./CommunityLinks";
import { SearchQuery } from "./controls";

let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  open.mockClear();
});

it("opens the Telegram channel, the chat and the Discord server in the browser", () => {
  act(() => root.render(<CommunityLinks />));
  expect(document.querySelector("h3")?.textContent).toBe("ui.settings.community.title");
  const buttons = [...document.querySelectorAll("button")];
  expect(buttons.map((button) => button.textContent)).toEqual(["ui.settings.community.channel", "ui.settings.community.chat", "ui.settings.community.discord"]);
  for (const button of buttons) act(() => button.click());
  expect(open.mock.calls.map(([url]) => url)).toEqual(["https://t.me/getnuvo", "https://t.me/getnuvo_chat", "https://discord.gg/rHz3dg9S9T"]);
  expect(document.querySelectorAll("a[href]")).toHaveLength(0);
});

it("hides the group when a settings search matches none of it", () => {
  act(() =>
    root.render(
      <SearchQuery.Provider value="equalizer">
        <CommunityLinks />
      </SearchQuery.Provider>,
    ),
  );
  expect(document.body.textContent).toBe("");
});
