import type { JSX } from "react";
import { HIGHLIGHT_MODES, setHighlightMode, useHighlightMode } from "../../karaoke/highlightMode";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { usePlayerStore } from "../../ports/player";
import { setVisualSettings, useVisualSettings } from "../../visual/settings";
import { CloseToTrayRow, MenuEntryRow } from "./CloseToTrayRow";
import { rowText, Segmented, SettingGroup, SettingRow, Switch } from "./controls";
import { CrossfadeBlock } from "./CrossfadeBlock";
import { DefaultSpeedBlock, KeepSpeedRow } from "./SoundSection";
import { LyricsModelRow, WordTimingRow } from "./WordTimingRow";

function choices<T extends string>(t: TFunction, base: string, values: readonly T[]) {
  return values.map((value) => ({ value, label: t(base + "." + value) }));
}

const DOUBLE_CLICK = "settings.track_double_click";
const START_CONTEXT = "settings.default_playback_context";
const AUTOPLAY = "settings.autoplay_similar";
const LYRICS_HIGHLIGHT = "settings.lyrics_highlight";
const VISUAL_PLAYER = "settings.visual_player";

export function StartupSection(): JSX.Element {
  const { t } = useTranslation();
  const startWith = usePlayerStore((store) => store.defaultPlaybackContext);
  const onStartWith = usePlayerStore((store) => store.setDefaultPlaybackContext);
  const startContext = rowText(t, START_CONTEXT);

  return (
    <>
      <SettingGroup>
        <SettingRow
          {...startContext}
          explained
          control={
            <Segmented label={startContext.title} options={choices(t, START_CONTEXT, ["resume", "empty"] as const)} value={startWith} onChange={onStartWith} />
          }
        />
      </SettingGroup>
      <SettingGroup label={t("settings.page.window")}>
        <CloseToTrayRow />
        <MenuEntryRow />
      </SettingGroup>
    </>
  );
}

export function PlaybackSection(): JSX.Element {
  const { t } = useTranslation();
  const doubleClick = rowText(t, DOUBLE_CLICK);
  const value = usePlayerStore((store) => store.trackDoubleClickBehavior);
  const onChange = usePlayerStore((store) => store.setTrackDoubleClickBehavior);

  return (
    <SettingGroup>
      <SettingRow
        {...doubleClick}
        explained
        control={<Segmented label={doubleClick.title} options={choices(t, DOUBLE_CLICK, ["play", "queue"] as const)} value={value} onChange={onChange} />}
      />
      <DefaultSpeedBlock />
    </SettingGroup>
  );
}

export function BetweenSongsSection(): JSX.Element {
  const { t } = useTranslation();
  const autoplay = rowText(t, AUTOPLAY);
  const similar = usePlayerStore((store) => store.autoplaySimilar);
  const onSimilar = usePlayerStore((store) => store.setAutoplaySimilar);

  return (
    <SettingGroup>
      <SettingRow {...autoplay} explained control={<Switch checked={similar} label={autoplay.title} onChange={onSimilar} />} />
      <CrossfadeBlock />
      <KeepSpeedRow />
    </SettingGroup>
  );
}

export function LyricsSection(): JSX.Element {
  const { t } = useTranslation();
  const lyricsHighlight = rowText(t, LYRICS_HIGHLIGHT);
  const visualPlayer = rowText(t, VISUAL_PLAYER);
  const visual = useVisualSettings();
  const highlightMode = useHighlightMode();

  return (
    <>
      <SettingGroup label={t("settings.page.karaoke")}>
        <SettingRow
          {...lyricsHighlight}
          explained
          control={
            <Segmented
              label={lyricsHighlight.title}
              options={choices(t, LYRICS_HIGHLIGHT, HIGHLIGHT_MODES)}
              value={highlightMode}
              onChange={setHighlightMode}
            />
          }
        />
        <WordTimingRow />
        <LyricsModelRow />
      </SettingGroup>
      <SettingGroup label={t("settings.page.scene")}>
        <SettingRow
          {...visualPlayer}
          explained
          control={<Switch checked={visual.enabled} label={visualPlayer.title} onChange={(enabled) => setVisualSettings({ enabled })} />}
        />
      </SettingGroup>
    </>
  );
}
