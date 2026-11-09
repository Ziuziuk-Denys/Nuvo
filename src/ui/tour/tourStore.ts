import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { settingsStorage } from "../ports/tour";
import { CHAPTER_IDS, stepCount, type ChapterId } from "./chapters";

export type TourPhase = "off" | "poster" | "chapter" | "brief";
export type PosterKind = "start" | "resume" | "more";
export type TourStatus = "new" | "on" | "later" | "done";

export const TOUR_KEY = "nuvo_tour_v1";

interface Saved {
  status: TourStatus;
  at: { chapter: ChapterId; step: number } | null;
  missed: ChapterId[];
}

interface TourState extends Saved {
  phase: TourPhase;
  poster: PosterKind;
  chapterIds: ChapterId[];
  chapter: number;
  step: number;
  dir: 1 | -1;
  gated: boolean;
  read: ChapterId[];
  briefRead: boolean;
  prompt: boolean;
  away: boolean;
  started: boolean;

  start: () => void;
  restore: () => void;
  offerMore: () => void;
  watch: () => void;
  rewatch: () => void;
  replay: () => void;
  decline: () => void;
  next: () => void;
  back: () => void;
  skipChapter: () => void;
  missing: () => void;
  missingChapter: () => void;
  openPrompt: () => void;
  closePrompt: () => void;
  later: () => void;
  toBrief: () => void;
  finish: () => void;
  markRead: () => void;
  markBriefRead: () => void;
  setAway: (away: boolean) => void;
  markStarted: () => void;
}

const at = (chapterIds: ChapterId[], chapter: number, step: number) => ({ chapter: chapterIds[chapter], step });

export const useTour = create<TourState>()(
  persist(
    (set, get) => {
      const go = (chapter: number, step: number, dir: 1 | -1) =>
        set((state) => ({ chapter, step, dir, prompt: false, at: at(state.chapterIds, chapter, step) }));

      const nextChapter = () => {
        const { chapter, chapterIds } = get();
        if (chapter + 1 < chapterIds.length) go(chapter + 1, 0, 1);
        else get().finish();
      };

      const back = () => {
        const { chapter, step, chapterIds } = get();
        if (step > 0) go(chapter, step - 1, -1);
        else if (chapter > 0) go(chapter - 1, stepCount(chapterIds[chapter - 1]) - 1, -1);
        else set({ dir: -1 });
      };

      return {
        status: "new",
        at: null,
        missed: [],
        phase: "off",
        poster: "start",
        chapterIds: [],
        chapter: 0,
        step: 0,
        dir: 1,
        gated: false,
        read: [],
        briefRead: false,
        prompt: false,
        away: false,
        started: false,

        start: () =>
          set({
            phase: "poster",
            poster: "start",
            status: "on",
            at: null,
            missed: [],
            gated: true,
            read: [],
            briefRead: false,
            prompt: false,
            away: false,
            started: false,
          }),

        restore: () => {
          const { status, at: place, phase } = get();
          if (phase === "off" && (status === "on" || status === "later"))
            set({ phase: "poster", poster: place ? "resume" : "start", gated: true, read: [], briefRead: false });
        },

        offerMore: () => {
          const { status, missed, phase } = get();
          if (status === "done" && missed.length > 0 && phase === "off") set({ phase: "poster", poster: "more" });
        },

        watch: () => {
          const { poster, at: place, missed } = get();
          if (poster === "more") {
            set({
              phase: "chapter",
              chapterIds: missed,
              missed: [],
              status: "on",
              gated: false,
              chapter: 0,
              step: 0,
              dir: 1,
              prompt: false,
              at: at(missed, 0, 0),
            });
            return;
          }
          const found = place ? CHAPTER_IDS.indexOf(place.chapter) : -1;
          const chapter = Math.max(0, found);
          const step = place && found >= 0 ? Math.min(place.step, stepCount(place.chapter) - 1) : 0;
          set({ phase: "chapter", chapterIds: CHAPTER_IDS, status: "on", chapter, step, dir: 1, prompt: false, at: at(CHAPTER_IDS, chapter, step) });
        },

        rewatch: () => {
          set({ poster: "start", at: null });
          get().watch();
        },

        replay: () => {
          set({ gated: false, missed: [], prompt: false, away: false });
          get().rewatch();
        },

        decline: () => set({ phase: "off", missed: [] }),

        next: () => {
          const { chapter, step, chapterIds } = get();
          if (step + 1 < stepCount(chapterIds[chapter])) go(chapter, step + 1, 1);
          else nextChapter();
        },

        back,

        skipChapter: nextChapter,

        missing: () => {
          const { dir, chapter, step } = get();
          if (dir === -1 && (chapter > 0 || step > 0)) back();
          else get().next();
        },

        missingChapter: () => {
          const { dir, chapter, chapterIds, missed } = get();
          const id = chapterIds[chapter];
          if (!missed.includes(id)) set({ missed: [...missed, id] });
          if (dir === -1 && chapter > 0) go(chapter - 1, stepCount(chapterIds[chapter - 1]) - 1, -1);
          else nextChapter();
        },

        openPrompt: () => set({ prompt: true }),
        closePrompt: () => set({ prompt: false }),
        later: () => set({ phase: "off", status: "later", prompt: false }),
        toBrief: () => set({ phase: "brief", prompt: false }),
        finish: () => set({ phase: "off", status: "done", at: null, prompt: false }),
        markRead: () => {
          const { chapterIds, chapter, read } = get();
          const id = chapterIds[chapter];
          if (id && !read.includes(id)) set({ read: [...read, id] });
        },
        markBriefRead: () => set({ briefRead: true }),
        setAway: (away) => set({ away }),
        markStarted: () => set({ started: true }),
      };
    },
    {
      name: TOUR_KEY,
      storage: createJSONStorage(() => settingsStorage),
      partialize: ({ status, at: place, missed }): Saved => ({ status, at: place, missed }),
    },
  ),
);

export function waiting(state: Pick<TourState, "gated" | "read" | "chapterIds" | "chapter">): boolean {
  return state.gated && !state.read.includes(state.chapterIds[state.chapter]);
}

export function briefWaiting(state: Pick<TourState, "gated" | "briefRead">): boolean {
  return state.gated && !state.briefRead;
}

export function lastStep(state: Pick<TourState, "chapterIds" | "chapter" | "step">): boolean {
  return state.chapter === state.chapterIds.length - 1 && state.step === stepCount(state.chapterIds[state.chapter]) - 1;
}
