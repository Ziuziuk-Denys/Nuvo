import { libraryClient, type ItemPlace } from "@/data/library/client";
import { useToastStore } from "@/ui/feedback/toastStore";
import { notifyLibraryChanged } from "@/data/library/changes";

export const UNDO_MS = 8000;

export interface TidyTexts {
  removed: string;
  undo: string;
  undoFailed: string;
  undoPartial: string;
  failed: string;
}

async function undo(playlistId: string, items: ItemPlace[], texts: TidyTexts): Promise<void> {
  try {
    const result = await libraryClient.insertItems(playlistId, items);
    notifyLibraryChanged();
    if (result.rejected > 0 || result.added < items.length) useToastStore.getState().show({ message: texts.undoPartial, variant: "error" });
  } catch {
    useToastStore.getState().show({ message: texts.undoFailed, variant: "error" });
  }
}

export async function removeWithUndo(playlistId: string, itemIds: readonly string[], texts: TidyTexts): Promise<void> {
  if (itemIds.length === 0) return;
  const wanted = new Set(itemIds);
  try {
    const items = await libraryClient.playlistItems(playlistId);
    const kept = items.filter((item) => wanted.has(item.id)).map(({ trackId, position, addedAt }) => ({ trackId, position, addedAt }));
    await libraryClient.removeItems(playlistId, [...wanted]);
    notifyLibraryChanged();
    useToastStore.getState().show({
      message: texts.removed,
      variant: "checkmark",
      duration: UNDO_MS,
      action: { label: texts.undo, onClick: () => void undo(playlistId, kept, texts) },
    });
  } catch {
    useToastStore.getState().show({ message: texts.failed, variant: "error" });
  }
}

export interface MoveTexts {
  done: string;
  undo: string;
  undoFailed: string;
  failed: string;
}

/** The daemon takes at most 5,000 item ids per call. */
const ITEM_CHUNK = 5000;

async function removeAll(playlistId: string, itemIds: string[]): Promise<void> {
  for (let at = 0; at < itemIds.length; at += ITEM_CHUNK) await libraryClient.removeItems(playlistId, itemIds.slice(at, at + ITEM_CHUNK));
}

async function undoing(texts: MoveTexts, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    useToastStore.getState().show({ message: texts.undoFailed, variant: "error" });
  }
  notifyLibraryChanged();
}

export async function moveWithUndo(playlistId: string, itemIds: readonly string[], targetId: string, texts: MoveTexts): Promise<void> {
  if (itemIds.length === 0) return;
  const wanted = new Set(itemIds);
  try {
    const places = (await libraryClient.playlistItems(playlistId))
      .filter((item) => wanted.has(item.id))
      .map(({ trackId, position, addedAt }) => ({ trackId, position, addedAt }));
    const { addedIds } = await libraryClient.transferItems(playlistId, [...wanted], targetId, "move");
    notifyLibraryChanged();
    useToastStore.getState().show({
      message: texts.done,
      variant: "checkmark",
      duration: UNDO_MS,
      action: {
        label: texts.undo,
        onClick: () =>
          void undoing(texts, async () => {
            await removeAll(targetId, addedIds);
            await libraryClient.insertItems(playlistId, places);
          }),
      },
    });
  } catch {
    useToastStore.getState().show({ message: texts.failed, variant: "error" });
  }
}

export async function mergeWithUndo(
  sourceId: string,
  targetId: string,
  deleteSource: boolean,
  texts: Omit<MoveTexts, "done"> & { done(added: number): string },
): Promise<boolean> {
  try {
    const result = await libraryClient.merge(targetId, [sourceId], deleteSource);
    notifyLibraryChanged();
    useToastStore.getState().show({
      message: texts.done(result.added),
      variant: "checkmark",
      duration: UNDO_MS,
      action: {
        label: texts.undo,
        onClick: () =>
          void undoing({ ...texts, done: "" }, async () => {
            await removeAll(targetId, result.addedItemIds);
            if (result.snapshots.length > 0) await libraryClient.restore(result.snapshots);
          }),
      },
    });
    return true;
  } catch {
    useToastStore.getState().show({ message: texts.failed, variant: "error" });
    return false;
  }
}

export const COVER_PX = 600;
/** The daemon's limit (`MAX_COVER_BYTES` in routes/playlists.rs). */
export const MAX_COVER_BYTES = 400 * 1024;

export function squareCrop(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

export type Encode = (file: Blob, quality: number) => Promise<Blob>;

export const encodeSquareWebp: Encode = async (file, quality) => {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = squareCrop(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(COVER_PX, COVER_PX);
    canvas.getContext("2d")!.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, COVER_PX, COVER_PX);
    return await canvas.convertToBlob({ type: "image/webp", quality });
  } finally {
    bitmap.close();
  }
};

// Main's native dialog picks the file: the page never supplies or sees a path
export async function pickPlaylistCover(): Promise<Blob | null> {
  const picked = await window.nuvoShell?.pickCoverImage().catch(() => null);
  return picked?.ok ? new Blob([picked.bytes as BlobPart], { type: picked.mime }) : null;
}

export async function setPlaylistCover(playlistId: string, file: Blob, failedText: string, encode: Encode = encodeSquareWebp): Promise<boolean> {
  try {
    for (const quality of [0.86, 0.7]) {
      const image = await encode(file, quality);
      if (image.size > MAX_COVER_BYTES) continue;
      await libraryClient.setCover(playlistId, image);
      notifyLibraryChanged();
      return true;
    }
  } catch {}
  useToastStore.getState().show({ message: failedText, variant: "error" });
  return false;
}

export async function removePlaylistCover(playlistId: string): Promise<void> {
  await libraryClient.removeCover(playlistId);
  notifyLibraryChanged();
}
