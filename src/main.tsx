import React from "react";
import ReactDOM from "react-dom/client";
import { LOCALE_BOOT_KEY, configureI18n, onLocaleChange, prepareLocale, setLocale, translate } from "@/i18n";
import { installErrorHandlers } from "./data/platform/errors";
import { bootPlayer, type PlayerBootPorts } from "./playerBoot";

installErrorHandlers();

configureI18n({
  onLoadError: () =>
    void import("./ui/feedback/toastStore").then(({ useToastStore }) =>
      useToastStore.getState().show({ message: translate("ui.language.load_failed"), variant: "error" }),
    ),
});

async function mainWindow(): Promise<React.ReactElement> {
  const [{ App }, { ErrorBoundary }, { bootYoutube }, { useToastStore }, { bootLyrics, linkLyricsToPlayer }] = await Promise.all([
    import("./ui/app/App"),
    import("./ui/feedback/ErrorBoundary"),
    import("./youtubeBoot"),
    import("./ui/feedback/toastStore"),
    import("./lyricsBoot"),
    prepareLocale(),
  ]);
  const lyrics = bootLyrics();
  await bootPlayer(async () => {
    const notify: PlayerBootPorts["notify"] = (notice) =>
      useToastStore.getState().show({
        message: "key" in notice ? translate(notice.key, notice.vars) : notice.text,
        variant: notice.kind === "error" ? "error" : "info",
        ...(notice.detail ? { description: notice.detail } : {}),
      });
    const youtube = bootYoutube((text) => notify({ kind: "info", text }));
    return { ...youtube.ports, notify, lyrics };
  });
  linkLyricsToPlayer();
  const sendThumbarLabels = () =>
    window.nuvoShell?.setThumbarLabels({
      previous: translate("ui.island.previous"),
      play: translate("ui.island.play"),
      pause: translate("ui.island.pause"),
      next: translate("ui.island.next"),
      like: translate("ui.island.like"),
      unlike: translate("ui.island.unlike"),
    });
  sendThumbarLabels();
  onLocaleChange(sendThumbarLabels);
  if (import.meta.env.DEV) await import("./data/platform/debug");
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

async function notchWindow(): Promise<React.ReactElement> {
  document.documentElement.dataset.theme = "dark";
  const [{ default: NotchApp }] = await Promise.all([import("./notch/NotchApp"), prepareLocale()]);
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_BOOT_KEY && event.newValue) void setLocale(event.newValue);
  });
  return <NotchApp />;
}

async function pocketWindow(): Promise<React.ReactElement> {
  const [{ default: PocketApp }] = await Promise.all([import("./pocket/PocketApp"), prepareLocale()]);
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_BOOT_KEY && event.newValue) void setLocale(event.newValue);
  });
  return <PocketApp />;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const boot = location.hash.startsWith("#/notch") ? notchWindow : location.hash.startsWith("#/pocket") ? pocketWindow : mainWindow;
  void boot().then((root) => {
    ReactDOM.createRoot(rootElement).render(<React.StrictMode>{root}</React.StrictMode>);
  });
}
