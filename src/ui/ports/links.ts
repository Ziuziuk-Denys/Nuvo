export { routeLink, type ImportService, type LinkRoute, type Service } from "@/links/router";
export { listenAgain, resolveLink, type LinkPorts, type LinkResult, type Stage } from "@/links/resolve";
export { displayText, errorMessage, notFoundMessage, serviceLabel, stageMessage, viaMessage, type Message } from "@/links/messages";
export { toPlayerTrack } from "@/links/playerTrack";
export { MAX_COPY_CHARS, buildShareLink, shareMessage, songLine, sourceUrl, textList, youtubeListUrl, type BuiltLink, type ShareItem } from "@/links/share";
export { PREVIEW_ROWS, importShare, lookupNames, previewRows, type ImportPorts, type PreviewRow } from "@/links/receive";
export { createLinkPorts, type YoutubeCatalog } from "@/links/ports";
export { onShareLink } from "@/links/inbox";
export { youtubeCatalog } from "@/links/youtubeCatalog";
export type { ImportSummary } from "@/links/core";
export type { Share } from "@/links/shareCodec";
export type { CatalogTrack, ImportTarget } from "@/links/types";

export async function playTrackById(id: string): Promise<void> {
  const { youtubeCatalog } = await import("@/links/youtubeCatalog");
  const { toPlayerTrack } = await import("@/links/playerTrack");
  const { playerEngine } = await import("@/engine/compat");
  const found = await youtubeCatalog.track(id, new AbortController().signal).catch(() => null);
  if (found) playerEngine.playTrack(toPlayerTrack(found));
}
export { deliverShareLink } from "@/links/inbox";
