export function acceptableMime(mime: string): boolean {
  const type = mime.split(";")[0].trim().toLowerCase();
  return type.startsWith("audio/") || type.startsWith("video/");
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

export function isCompleteMediaFile(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (bytes.length >= 8 && ascii(bytes, 4, "ftyp")) return true;
  if (ascii(bytes, 0, "OggS") || ascii(bytes, 0, "fLaC")) return true;
  if (bytes.length >= 12 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return true;
  if (ascii(bytes, 0, "ID3")) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

export function isPartial(contentRange: string | null, receivedBytes: number): boolean {
  if (!contentRange) return false;
  if (/\/\*\s*$/.test(contentRange)) return true;
  const match = /\/(\d+)\s*$/.exec(contentRange);
  return match ? Number(match[1]) > receivedBytes : false;
}

export async function checkCacheWrite(blob: Blob, mime: string, contentRange: string | null = null): Promise<boolean> {
  if (!acceptableMime(mime) || isPartial(contentRange, blob.size)) return false;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return isCompleteMediaFile(head);
}
