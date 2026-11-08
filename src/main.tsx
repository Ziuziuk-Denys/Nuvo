import React from "react";
import ReactDOM from "react-dom/client";
import { configureI18n, prepareLocale, translate } from "@/i18n";
import { installErrorHandlers } from "./data/platform/errors";
import { bootPlayer, type PlayerBootPorts } from "./playerBoot";

/** Boot order: error handlers first. The Notch window only needs its own root. */
installErrorHandlers();

// a language that fails to load keeps the current one and says so in that language
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
      useToastStore
        .getState()
        .show({ message: notice.text, variant: notice.kind === "error" ? "error" : "info", ...(notice.detail ? { description: notice.detail } : {}) });
    const youtube = bootYoutube((text) => notify({ kind: "info", text }));
    return { ...youtube.ports, notify, lyrics };
  });
  linkLyricsToPlayer();
  if (import.meta.env.DEV) await import("./data/platform/debug");
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

async function notchWindow(): Promise<React.ReactElement> {
  const { default: NotchApp } = await import("./notch/NotchApp");
  return <NotchApp />;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  void (location.hash.startsWith("#/notch") ? notchWindow() : mainWindow()).then((root) => {
    ReactDOM.createRoot(rootElement).render(<React.StrictMode>{root}</React.StrictMode>);
  });
}
