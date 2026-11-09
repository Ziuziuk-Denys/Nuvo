import { useEffect, useState } from "react";
import type { MenuItem } from "../../components/Menu";
import type { TFunction } from "../../ports/i18n";
import {
  useExternalItems,
  useHomePinsStore,
  useRailPinsStore,
  useRemoveExternalItem,
  useSaveExternalItem,
  type HomePin,
  type LibraryItemViewModel,
} from "../../ports/library";

type SavedKind = "album" | "artist" | "playlist";

export function useSaved(
  kind: SavedKind,
  id: string,
  snapshot: () => Record<string, unknown>,
): { saved: boolean; toggle: () => void; item?: LibraryItemViewModel } {
  const { data } = useExternalItems(kind);
  const save = useSaveExternalItem();
  const remove = useRemoveExternalItem();
  const item = data.find((entry) => entry.id === id);
  const listed = item !== undefined;
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => setOverride(null), [listed]);
  const saved = override ?? listed;
  const toggle = () => {
    const next = !saved;
    setOverride(next);
    const options = { onError: () => setOverride(null) };
    if (next) save.mutate({ type: kind, id, snapshot: snapshot() }, options);
    else remove.mutate({ type: kind, id, isOwned: false }, options);
  };
  return { saved, toggle, item };
}

export function pinMenuItems(pin: HomePin, onHome: boolean, onRail: boolean, t: TFunction): MenuItem[] {
  return [
    onHome
      ? { label: t("ui.library.unpin"), onSelect: () => useHomePinsStore.getState().unpin(pin.kind, pin.id) }
      : { label: t("ui.library.pin"), onSelect: () => useHomePinsStore.getState().pin(pin) },
    onRail
      ? { label: t("ui.library.unpin_rail"), onSelect: () => useRailPinsStore.getState().unpin(pin.kind, pin.id) }
      : { label: t("ui.library.pin_rail"), onSelect: () => useRailPinsStore.getState().pin(pin) },
  ];
}

export function usePinItems(pin: HomePin, t: TFunction): MenuItem[] {
  const same = (item: HomePin) => item.kind === pin.kind && item.id === pin.id;
  const onHome = useHomePinsStore((state) => state.pins.some(same));
  const onRail = useRailPinsStore((state) => state.pins.some(same));
  return pinMenuItems(pin, onHome, onRail, t);
}
