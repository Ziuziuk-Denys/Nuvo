import { useEffect, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { downloadTool, programLabel, readTools, ROW_PROGRAM, TOOL_ROWS, type ToolRowName, type ToolsView } from "../../ports/system";
import { downloadText } from "../../shell/useToolDownloadToast";
import { SettingGroup, SettingRow } from "./controls";

const TITLE = "ui.settings.tools.title";
const ROLE: Record<ToolRowName, string> = {
  "yt-dlp": "ui.settings.tools.yt_dlp",
  "js-runtime": "ui.settings.tools.js_runtime",
  ffmpeg: "ui.settings.tools.ffmpeg",
};
/** Polls this long after "Download again", until the download shows up. */
const ASKED_POLLS = 15;

export function toolState(name: ToolRowName, view: ToolsView, t: TFunction): string {
  const download = view.download?.tool === ROW_PROGRAM[name] ? view.download : undefined;
  if (download?.failed) return t("ui.settings.tools.failed", { tool: programLabel(download.tool) });
  if (download) return downloadText(download, t);
  const tool = view.tools.find((row) => row.name === name);
  return t(`ui.settings.tools.status_${tool?.status ?? "missing"}`, { version: tool?.version ?? "" });
}

export function ToolsGroup(): JSX.Element | null {
  const { t } = useTranslation();
  const [view, setView] = useState<ToolsView | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const read = async () => {
      const value = await readTools();
      if (!live) return;
      setView(value);
      polls += 1;
      const busy = value?.download && !value.download.failed;
      if (busy || (asked > 0 && polls < ASKED_POLLS)) timer = setTimeout(() => void read(), 1000);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [asked]);

  if (!view) return null;
  const busy = view.download !== undefined && !view.download.failed;
  const again = async (name: ToolRowName) => {
    if (await downloadTool(name)) setAsked((count) => count + 1);
  };

  return (
    <SettingGroup label={t(TITLE)}>
      {TOOL_ROWS.map((name) => (
        <SettingRow
          key={name}
          title={name === "js-runtime" ? t("ui.settings.tools.js_runtime_title") : name}
          description={`${t(ROLE[name])} ${toolState(name, view, t)}`}
          titleKey={TITLE}
          descKey={ROLE[name]}
          explained
          control={
            <Button size="s" disabled={busy} onClick={() => void again(name)}>
              {t("ui.settings.tools.download_again")}
            </Button>
          }
        />
      ))}
    </SettingGroup>
  );
}
