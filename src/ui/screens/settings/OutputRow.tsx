import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Menu, type MenuItem } from "../../components/Menu";
import { useTranslation } from "../../ports/i18n";
import { playerOutputs, usePlayerStore, type OutputDevice } from "../../ports/player";
import { SettingRow } from "./controls";

const TITLE = "ui.settings.output";
const DESCRIPTION = "ui.settings.output_desc";

/** Where the sound goes. The list is read on every open, since devices come and go. */
export function OutputRow(): JSX.Element {
  const { t } = useTranslation();
  const label = usePlayerStore((state) => state.outputLabel);
  const chosen = usePlayerStore((state) => state.outputChosen);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [devices, setDevices] = useState<OutputDevice[]>([]);

  const open = async (button: HTMLElement) => {
    setDevices(await playerOutputs.list().catch(() => []));
    setAnchor(button);
  };

  const items: MenuItem[] = devices.map((device) => ({
    label: device.label,
    // the system default entry has the empty id; the engine calls it null
    icon: (device.id || null) === chosen ? "check" : undefined,
    onSelect: () => void playerOutputs.choose(device.id || null),
  }));

  return (
    <>
      <SettingRow
        title={t(TITLE)}
        description={t(DESCRIPTION)}
        titleKey={TITLE}
        descKey={DESCRIPTION}
        control={
          <Button size="s" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={(event) => void open(event.currentTarget)}>
            {label ?? t("ui.settings.output_default")}
          </Button>
        }
      />
      <Menu open={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} items={items} />
    </>
  );
}
