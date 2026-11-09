type Obj = Record<string, unknown>;

export const SEP = { text: " • " };

export function run(text: string, link?: { browseId: string; pageType?: string; params?: string } | { videoId: string; playlistId?: string }): Obj {
  if (!link) return { text };
  if ("videoId" in link) return { text, navigationEndpoint: { watchEndpoint: link } };
  return {
    text,
    navigationEndpoint: browse(link.browseId, link.pageType, link.params),
  };
}

export function browse(browseId: string, pageType?: string, params?: string): Obj {
  return {
    browseEndpoint: {
      browseId,
      ...(params ? { params } : {}),
      ...(pageType
        ? {
            browseEndpointContextSupportedConfigs: {
              browseEndpointContextMusicConfig: {
                pageType: `MUSIC_PAGE_TYPE_${pageType}`,
              },
            },
          }
        : {}),
    },
  };
}

export const artistRun = (name: string, id: string) => run(name, { browseId: id, pageType: "ARTIST" });
export const channelRun = (name: string, id: string) => run(name, { browseId: id, pageType: "USER_CHANNEL" });
export const albumRun = (title: string, id: string) => run(title, { browseId: id, pageType: "ALBUM" });

export const runs = (...items: Obj[]) => ({ runs: items });

export function thumb(url: string, width: number, height: number): Obj {
  return {
    musicThumbnailRenderer: {
      thumbnail: { thumbnails: [{ url, width, height }] },
    },
  };
}

export const ART = (size = 60) => `https://lh3.googleusercontent.com/art=w${size}-h${size}-l90-rj`;

export const EXPLICIT = [{ musicInlineBadgeRenderer: { icon: { iconType: "MUSIC_EXPLICIT_BADGE" } } }];

const flex = (text: Obj) => ({
  musicResponsiveListItemFlexColumnRenderer: { text },
});

export interface SongRow {
  id: string;
  title: string;
  artists?: Array<[string, string]>;
  album?: [string, string];
  duration?: string;
  kind?: string;
  extra?: string[];
  thumbnail?: Obj;
  explicit?: boolean;
  artistText?: string;
}

export function songRow(song: SongRow): Obj {
  const second: Obj[] = [];
  const push = (item: Obj) => {
    if (second.length > 0) second.push(SEP);
    second.push(item);
  };
  if (song.kind) push(run(song.kind));
  for (const [name, id] of song.artists ?? []) push(artistRun(name, id));
  if (song.artistText) push(run(song.artistText));
  if (song.album) push(albumRun(song.album[0], song.album[1]));
  for (const extra of song.extra ?? []) push(run(extra));
  if (song.duration) push(run(song.duration));
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [flex(runs(run(song.title, { videoId: song.id }))), flex({ runs: second })],
      ...(song.thumbnail ? { thumbnail: song.thumbnail } : {}),
      playlistItemData: { videoId: song.id },
      ...(song.explicit ? { badges: EXPLICIT } : {}),
    },
  };
}

export function browseRow(pageType: "ARTIST" | "ALBUM" | "PLAYLIST" | "USER_CHANNEL", id: string, title: string, second: Obj[] = [], thumbnail?: Obj): Obj {
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [flex(runs(run(title))), flex({ runs: second })],
      navigationEndpoint: browse(id, pageType),
      ...(thumbnail ? { thumbnail } : {}),
    },
  };
}

export function card(options: { title: string; target: Obj; subtitle: Obj[]; thumbnail?: Obj; contents?: Obj[] }): Obj {
  return {
    musicCardShelfRenderer: {
      title: runs(run(options.title)),
      subtitle: { runs: options.subtitle },
      onTap: options.target,
      ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
      ...(options.contents ? { contents: options.contents } : {}),
    },
  };
}

export function searchResponse(...sections: Obj[]): Obj {
  return {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: { sectionListRenderer: { contents: sections } },
            },
          },
        ],
      },
    },
  };
}

export const shelf = (...rows: Obj[]) => ({
  musicShelfRenderer: { contents: rows },
});

export interface QueueRow {
  id: string;
  title: string;
  byline: Obj[];
  length?: string;
  selected?: boolean;
}

export function queueRow(row: QueueRow): Obj {
  return {
    playlistPanelVideoRenderer: {
      videoId: row.id,
      title: runs(run(row.title)),
      longBylineText: { runs: row.byline },
      ...(row.length ? { lengthText: runs(run(row.length)) } : {}),
      selected: row.selected ?? false,
    },
  };
}

export function nextResponse(...rows: Obj[]): Obj {
  return {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    musicQueueRenderer: {
                      content: { playlistPanelRenderer: { contents: rows } },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

export function responsiveHeader(options: {
  title: string;
  strapline?: Obj[];
  subtitle?: Obj[];
  secondSubtitle?: string;
  description?: string;
  thumbnail?: Obj;
}): Obj {
  return {
    musicResponsiveHeaderRenderer: {
      title: runs(run(options.title)),
      ...(options.strapline ? { straplineTextOne: { runs: options.strapline } } : {}),
      ...(options.subtitle ? { subtitle: { runs: options.subtitle } } : {}),
      ...(options.secondSubtitle ? { secondSubtitle: runs(run(options.secondSubtitle)) } : {}),
      ...(options.description
        ? {
            description: {
              musicDescriptionShelfRenderer: {
                description: runs(run(options.description)),
              },
            },
          }
        : {}),
      ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
    },
  };
}

export function browsePage(header: Obj | undefined, rows: Obj[], token?: string, extra: Obj = {}): Obj {
  return {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: { contents: header ? [header] : [] },
              },
            },
          },
        ],
        secondaryContents: {
          sectionListRenderer: {
            contents: [
              {
                musicPlaylistShelfRenderer: {
                  contents: [...rows, ...(token ? [continuationItem(token)] : [])],
                },
              },
            ],
          },
        },
      },
    },
    ...extra,
  };
}

export const continuationItem = (token: string) => ({
  continuationItemRenderer: {
    continuationEndpoint: { continuationCommand: { token } },
  },
});

export function continuationPage(rows: Obj[], token?: string): Obj {
  return {
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          continuationItems: [...rows, ...(token ? [continuationItem(token)] : [])],
        },
      },
    ],
  };
}

export function twoRowItem(options: { title: string; id: string; pageType?: string; subtitle: string[]; thumbnail?: Obj; explicit?: boolean }): Obj {
  const subtitle: Obj[] = [];
  options.subtitle.forEach((part, index) => {
    if (index > 0) subtitle.push(SEP);
    subtitle.push(run(part));
  });
  return {
    musicTwoRowItemRenderer: {
      title: runs(
        run(options.title, {
          browseId: options.id,
          pageType: options.pageType ?? "ALBUM",
        }),
      ),
      subtitle: { runs: subtitle },
      ...(options.thumbnail ? { thumbnailRenderer: options.thumbnail } : {}),
      navigationEndpoint: browse(options.id, options.pageType ?? "ALBUM"),
      ...(options.explicit ? { subtitleBadges: EXPLICIT } : {}),
    },
  };
}

export function carousel(title: string, items: Obj[]): Obj {
  return {
    musicCarouselShelfRenderer: {
      header: {
        musicCarouselShelfBasicHeaderRenderer: { title: runs(run(title)) },
      },
      contents: items,
    },
  };
}
