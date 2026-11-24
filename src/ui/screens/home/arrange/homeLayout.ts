import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { settingsStorage } from "../../../ports/tour";

export const SECTIONS = ["mixes", "continue", "mood", "songs", "memory", "like", "shuffle", "style"] as const;
export type SectionId = (typeof SECTIONS)[number];

interface HomeLayout {
  order: SectionId[];
  hidden: SectionId[];
  arranging: boolean;
  move(from: number, to: number): void;
  toggle(id: SectionId): void;
  reset(): void;
  arrange(open: boolean): void;
}

// A section added by an update takes its default place among the saved ones
export function completeOrder(saved: unknown): SectionId[] {
  const known = (Array.isArray(saved) ? saved : []).filter((id, index, all): id is SectionId => SECTIONS.includes(id) && all.indexOf(id) === index);
  for (const [index, id] of SECTIONS.entries()) {
    if (known.includes(id)) continue;
    const before = SECTIONS.slice(0, index).reverse().find((earlier) => known.includes(earlier));
    known.splice(before ? known.indexOf(before) + 1 : 0, 0, id);
  }
  return known;
}

export const useHomeLayout = create<HomeLayout>()(
  persist(
    (set) => ({
      order: [...SECTIONS],
      hidden: [],
      arranging: false,
      move: (from, to) =>
        set(({ order }) => {
          const next = [...order];
          next.splice(to, 0, ...next.splice(from, 1));
          return { order: next };
        }),
      toggle: (id) => set(({ hidden }) => ({ hidden: hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id] })),
      reset: () => set({ order: [...SECTIONS], hidden: [] }),
      arrange: (arranging) => set({ arranging }),
    }),
    {
      name: "nuvo.home.v1",
      storage: createJSONStorage(() => settingsStorage),
      partialize: ({ order, hidden }) => ({ order, hidden }),
      merge: (saved, current) => {
        const { order, hidden } = (saved ?? {}) as { order?: unknown; hidden?: unknown };
        return { ...current, order: completeOrder(order), hidden: Array.isArray(hidden) ? SECTIONS.filter((id) => hidden.includes(id)) : [] };
      },
    },
  ),
);
