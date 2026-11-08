/** The route of one playlist page; "likes" is the liked songs. */
export function playlistHref(id: string): string {
  return `/library/playlist?id=${encodeURIComponent(id)}`;
}
