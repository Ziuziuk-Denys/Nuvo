export type TargetId =
  | "island"
  | "search-bar"
  | "palette"
  | "nav-recognize"
  | "recognize-sources"
  | "scrubber"
  | "rate"
  | "lyrics"
  | "queue"
  | "sound-button"
  | "sound-panel"
  | "sound-eq"
  | "sound-speed"
  | "sound-sleep"
  | "add-button"
  | "new-playlist"
  | "library-tabs"
  | "library-import"
  | "mixes"
  | "home-start"
  | "presets"
  | "modes";

export type Route = "/" | "/recognize" | "/library";

export type Act = { kind: "route"; path: Route } | { kind: "press"; target: TargetId } | { kind: "settings"; section: string } | { kind: "palette" };

export type Side = "below" | "above" | "right" | "left";

export interface Step {
  target: TargetId;
  text: string;
  act?: Act[];
  interactive?: boolean;
  side?: Side;
  alt?: { target: TargetId; text: string };
}

export type ChapterId = "search" | "recognize" | "player" | "sound" | "playlists" | "library" | "home" | "look";

export interface Chapter {
  id: ChapterId;
  needs?: TargetId;
  demo?: boolean;
  scene: Act[];
  steps: Step[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: "search",
    scene: [],
    steps: [
      { target: "search-bar", text: "search_bar", side: "below" },
      // right of the panel: below it would cover the results it describes
      { target: "palette", text: "palette", act: [{ kind: "palette" }], side: "right" },
    ],
  },
  {
    id: "recognize",
    scene: [],
    steps: [
      { target: "nav-recognize", text: "nav_recognize", side: "below" },
      { target: "recognize-sources", text: "recognize_sources", act: [{ kind: "route", path: "/recognize" }] },
    ],
  },
  {
    id: "player",
    needs: "island",
    demo: true,
    scene: [{ kind: "route", path: "/" }],
    steps: [
      { target: "scrubber", text: "scrubber", side: "above" },
      { target: "lyrics", text: "lyrics", side: "above" },
      { target: "rate", text: "rate", side: "above" },
      { target: "queue", text: "queue", side: "above" },
    ],
  },
  {
    id: "sound",
    needs: "sound-button",
    demo: true,
    scene: [{ kind: "press", target: "sound-button" }],
    steps: [
      { target: "sound-panel", text: "eq", act: [{ kind: "press", target: "sound-eq" }], side: "left" },
      { target: "sound-panel", text: "speed", act: [{ kind: "press", target: "sound-speed" }], side: "left" },
      { target: "sound-panel", text: "sleep", act: [{ kind: "press", target: "sound-sleep" }], side: "left" },
    ],
  },
  {
    id: "playlists",
    demo: true,
    scene: [],
    steps: [
      { target: "add-button", text: "add", side: "above" },
      { target: "new-playlist", text: "new_playlist", act: [{ kind: "route", path: "/library" }] },
    ],
  },
  {
    id: "library",
    scene: [{ kind: "route", path: "/library" }],
    steps: [
      { target: "library-tabs", text: "library_tabs" },
      { target: "library-import", text: "library_import" },
    ],
  },
  {
    id: "home",
    scene: [{ kind: "route", path: "/" }],
    steps: [{ target: "mixes", text: "mixes", alt: { target: "home-start", text: "home_start" } }],
  },
  {
    id: "look",
    scene: [{ kind: "settings", section: "appearance" }],
    steps: [
      // above: below it would cover New theme and Import theme
      { target: "presets", text: "presets", interactive: true, side: "above" },
      { target: "modes", text: "modes", interactive: true },
    ],
  },
];

export const CHAPTER_IDS: ChapterId[] = CHAPTERS.map((chapter) => chapter.id);

export function chapterById(id: ChapterId | undefined): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.id === id);
}

export function stepCount(id: ChapterId | undefined): number {
  return chapterById(id)?.steps.length ?? 1;
}
