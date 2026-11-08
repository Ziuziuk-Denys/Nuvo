/*
  The tour script. Each chapter sets its scene once on entry (a page, an open panel), then shows its steps
  one at a time: one outline on the real interface and one callout. A chapter whose `needs` target is not
  on screen is left out; a step whose target does not mount shows its stand-in, else is passed over.
  A `demo` chapter puts a sample song in the player bar while it runs, so a first launch sees the player too.
*/

export type TargetId =
  | "island"
  | "rail-search"
  | "search-field"
  | "rail-recognize"
  | "recognize-sources"
  | "scrubber"
  | "like"
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

export type Route = "/" | "/search" | "/recognize" | "/library";

/** One thing a scene or a step does on the real window before its outline appears. */
export type Act = { kind: "route"; path: Route } | { kind: "press"; target: TargetId } | { kind: "settings"; section: string };

export type Side = "below" | "above" | "right" | "left";

export interface Step {
  target: TargetId;
  /** Key under ui.tour.steps */
  text: string;
  act?: Act[];
  /** The outlined control takes clicks, so the step can be done for real (the theme pick) */
  interactive?: boolean;
  /** Where the callout tries first */
  side?: Side;
  /** What the step shows when its target is not there, such as Home's first-run card before any mix exists */
  alt?: { target: TargetId; text: string };
}

export type ChapterId = "search" | "recognize" | "player" | "sound" | "playlists" | "library" | "home" | "look";

export interface Chapter {
  id: ChapterId;
  needs?: TargetId;
  /** The player bar holds a sample song while this chapter runs, when nothing is loaded */
  demo?: boolean;
  scene: Act[];
  steps: Step[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: "search",
    scene: [],
    steps: [
      { target: "rail-search", text: "rail_search", side: "right" },
      { target: "search-field", text: "search_field", act: [{ kind: "route", path: "/search" }] },
    ],
  },
  {
    id: "recognize",
    scene: [],
    steps: [
      { target: "rail-recognize", text: "rail_recognize", side: "right" },
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
      { target: "like", text: "like", side: "above" },
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

/** An unknown id counts as one step, so the tour still moves on. */
export function stepCount(id: ChapterId | undefined): number {
  return chapterById(id)?.steps.length ?? 1;
}
