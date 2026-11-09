import { importFile, listLink, postListing, soundcloudLikesUrl, type ListPorts, type PostPorts } from "./flow";
import { ImportError, type ImportSummary, type ImportTarget, type Listing } from "./types";

export interface ImportActions {
  list(text: string, signal: AbortSignal, onProgress: (count: number) => void): Promise<Listing>;
  listLikes(nameOrUrl: string, signal: AbortSignal, onProgress: (count: number) => void): Promise<Listing>;
  post(listing: Listing, target?: ImportTarget): Promise<ImportSummary[]>;
  importFile(file: File, target?: ImportTarget): Promise<ImportSummary[]>;
}

/** Below the daemon's 10 MB file cap, which keeps the base64 body under its 16 MB limit. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function createImportActions(ports: ListPorts & PostPorts): ImportActions {
  return {
    list: (text, signal, onProgress) => listLink(text, ports, signal, onProgress),
    listLikes: (nameOrUrl, signal, onProgress) => listLink(soundcloudLikesUrl(nameOrUrl), ports, signal, onProgress),
    post: (listing, target) => postListing(listing, target, ports),
    async importFile(file, target) {
      if (file.size > MAX_FILE_BYTES) throw new ImportError("file_too_large");
      const bytes = await file.arrayBuffer().catch(() => null);
      if (bytes === null) throw new ImportError("bad_file");
      return importFile({ name: file.name, data: toBase64(bytes) }, target, ports);
    },
  };
}
