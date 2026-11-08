/** Deezer API answers for tests, invented names. */
export function deezerTrack(index: number, album = "Northbound") {
  return {
    id: 3_000_000 + index,
    title: `Song ${index}`,
    duration: 180 + (index % 60),
    artist: { id: 1, name: "Mira Holt" },
    album: {
      id: 2,
      title: album,
      cover: "https://e-cdns-images.dzcdn.net/images/cover/x/250x250.jpg",
    },
  };
}

export function deezerTracks(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => deezerTrack(from + i));
}
