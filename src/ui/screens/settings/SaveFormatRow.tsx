import { useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { saveFormat, setSaveFormat, type SaveFormat } from "../../ports/exports";
import { Segmented, SettingRow } from "./controls";

export function SaveFormatRow(): JSX.Element {
  const { t } = useTranslation();
  const [format, setFormat] = useState<SaveFormat>(saveFormat);
  return (
    <SettingRow
      title={t("ui.settings.save_format.title")}
      description={t("ui.settings.save_format.description")}
      titleKey="ui.settings.save_format.title"
      descKey="ui.settings.save_format.description"
      explained
      control={
        <Segmented
          label={t("ui.settings.save_format.title")}
          value={format}
          onChange={(next) => {
            setSaveFormat(next);
            setFormat(next);
          }}
          options={[
            { value: "original", label: t("ui.settings.save_format.original") },
            { value: "mp3", label: "MP3" },
          ]}
        />
      }
    />
  );
}
