export function playlistHref(id: string): string {
  return `/library/playlist?id=${encodeURIComponent(id)}`;
}
