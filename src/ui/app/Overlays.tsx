import type { JSX } from "react";
import { NewPlaylistSheet } from "../screens/library/NewPlaylistSheet";
import { RemoveFromLibrarySheet, RemoveFromPlaylistSheet } from "../screens/library/RemoveSheets";
import { HelpSheets } from "../screens/settings/HelpSheets";
import { SafeModeBanner } from "../screens/settings/SafeModeBanner";
import { Settings } from "../screens/settings/Settings";
import { ThemeEditorHost } from "../screens/settings/ThemeEditor";
import { ConnectionWatch } from "../feedback/ConnectionWatch";
import { PanelWidgetWatch } from "../feedback/PanelWidgetWatch";
import { Toaster } from "../feedback/Toaster";
import { UpdateOffer } from "../feedback/UpdateOffer";
import { QueuePanel } from "../shell/queue/QueuePanel";
import { SignInSheet } from "../shell/SignInSheet";

export function Overlays(): JSX.Element {
  return (
    <>
      <QueuePanel />
      <SafeModeBanner />
      <Settings />
      <ThemeEditorHost />
      <NewPlaylistSheet />
      <RemoveFromLibrarySheet />
      <RemoveFromPlaylistSheet />
      <SignInSheet />
      <HelpSheets />
      <Toaster />
      <ConnectionWatch />
      <PanelWidgetWatch />
      <UpdateOffer />
    </>
  );
}
