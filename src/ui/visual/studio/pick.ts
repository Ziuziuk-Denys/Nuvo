import { sceneOf, type Part, type Selection } from "../../ports/visual";

export interface PickNotice {
  key: string;
  values?: Record<string, string>;
}

export interface PickResult {
  selection: Selection | null;
  notice: PickNotice | null;
}

function requested(selection: Selection, part: Part): Selection {
  if (part.slot === "atmosphere") {
    const list = selection.atmosphere;
    return { ...selection, atmosphere: list.includes(part.id) ? list.filter((id) => id !== part.id) : [...list, part.id] };
  }
  if (part.slot === "background") return { ...selection, background: part.id };
  return { ...selection, [part.slot]: selection[part.slot] === part.id ? null : part.id };
}

const has = (selection: Selection, part: Part) => (part.slot === "atmosphere" ? selection.atmosphere.includes(part.id) : selection[part.slot] === part.id);

export function applyPick(selection: Selection, part: Part, maxEffects: number): PickResult {
  const adding = !has(selection, part);
  if (part.slot === "atmosphere" && adding && selection.atmosphere.length >= maxEffects) {
    return { selection: null, notice: { key: "visual.studio.effects_full", values: { max: String(maxEffects) } } };
  }
  const want = requested(selection, part);
  const { selection: shown, issues } = sceneOf(want);
  if (adding && !has(shown, part)) {
    return { selection: null, notice: { key: issues.includes("weather") ? "visual.studio.pick_weather" : "visual.studio.pick_heavy" } };
  }
  let notice: PickNotice | null = null;
  if (shown.background !== want.background)
    notice = { key: "visual.studio.pick_background", values: { part: want.lyrics ?? part.id, background: shown.background } };
  else if (want.lyrics && shown.lyrics !== want.lyrics) notice = { key: "visual.studio.pick_calm", values: { part: want.lyrics, calm: shown.lyrics ?? "" } };
  return { selection: shown, notice };
}
