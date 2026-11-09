export interface AppleFixtureTrack {
  title?: string;
  artists?: string[];
  album?: string;
  durationMs?: number;
}

export function applePage(options: { title: string; trackCount?: number; tracks: AppleFixtureTrack[] }): string {
  const header = {
    itemKind: "containerDetailHeaderLockup",
    items: [
      {
        title: options.title,
        trackCount: options.trackCount ?? options.tracks.length,
      },
    ],
  };
  const list = {
    itemKind: "trackLockup",
    items: options.tracks.map((track, index) => ({
      title: track.title ?? "",
      duration: track.durationMs,
      subtitleLinks: (track.artists ?? []).map((name) => ({ title: name })),
      tertiaryLinks: track.album ? [{ title: track.album }] : [],
      contentDescriptor: { identifiers: { storeAdamID: String(1000 + index) } },
    })),
  };
  const data = [
    {
      data: {
        sections: [header, { itemKind: "otherLockup", items: [] }, list],
      },
    },
  ];
  return `<!DOCTYPE html><html><head><title>${options.title}</title></head><body><script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script></body></html>`;
}

export const MORNING = applePage({
  title: "Morning Light",
  tracks: [
    {
      title: "Paper Moons",
      artists: ["Mira Holt"],
      album: "Harbour",
      durationMs: 201_000,
    },
    {
      title: "Glass River",
      artists: ["Nadia Rowe", "Tomas Vey"],
      album: "Northbound",
      durationMs: 187_500,
    },
    { title: "Slow Tide", artists: [], album: "Harbour", durationMs: 240_000 },
  ],
});
