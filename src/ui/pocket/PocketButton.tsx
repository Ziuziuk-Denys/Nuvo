import type { JSX } from "react";
import { IconButton } from "../components/IconButton";
import { useTranslation } from "../ports/i18n";
import { togglePocket, usePocketStore } from "../ports/pocket";

export function PocketButton({ className }: { className?: string }): JSX.Element {
  const { t } = useTranslation();
  const open = usePocketStore((state) => state.open);
  return <IconButton icon="pocket" label={t(open ? "ui.pocket.put_away" : "ui.pocket.open")} active={open} className={className} onClick={togglePocket} />;
}
