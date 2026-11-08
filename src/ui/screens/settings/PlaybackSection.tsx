import type { JSX } from "react";
import { useShallow } from "zustand/react/shallow";
import { HIGHLIGHT_MODES, setHighlightMode, useHighlightMode } from "../../karaoke/highlightMode";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { usePlayerStore } from "../../ports/player";
import { CloseToTrayRow, MenuEntryRow } from "./CloseToTrayRow";
import { Segmented, SettingGroup, SettingRow, Switch } from "./controls";
import { StatsPauseRow } from "./StatsPauseRow";

/** Title, description and their search keys for a settings row, from the key both share. */
function rowText(t: TFunction, base: string) {
  const titleKey = base + ".title";
  const descKey = base + ".description";
  return { titleKey, descKey, title: t(titleKey), description: t(descKey) };
}

/** Segment choices whose labels sit next to the row's own keys: base.<value>. */
function choices<T extends string>(t: TFunction, base: string, values: readonly T[]) {
  return values.map((value) => ({ value, label: t(base + "." + value) }));
}

const DOUBLE_CLICK = "settings.track_double_click";
const START_CONTEXT = "settings.default_playback_context";
const AUTOPLAY = "settings.autoplay_similar";
const DEVICE_PAUSE = "settings.audio.pause_on_device_change";
const LYRICS_HIGHLIGHT = "settings.lyrics_highlight";

export function PlaybackSection(): JSX.Element {
  const { t } = useTranslation();
  // a shallow pick re-renders only on these settings, not on the store's fast playback fields
  const prefs = usePlayerStore(
    useShallow((store) => ({
      similar: store.autoplaySimilar,
      onSimilar: store.setAutoplaySimilar,
      doubleClick: store.trackDoubleClickBehavior,
      onDoubleClick: store.setTrackDoubleClickBehavior,
      startWith: store.defaultPlaybackContext,
      onStartWith: store.setDefaultPlaybackContext,
      devicePause: store.pauseOnDeviceChange,
      onDevicePause: store.setPauseOnDeviceChange,
    })),
  );
  const autoplay = rowText(t, AUTOPLAY);
  const doubleClick = rowText(t, DOUBLE_CLICK);
  const startContext = rowText(t, START_CONTEXT);
  const devicePause = rowText(t, DEVICE_PAUSE);
  const lyricsHighlight = rowText(t, LYRICS_HIGHLIGHT);
  const highlightMode = useHighlightMode();

  return (
    <SettingGroup>
      <SettingRow {...autoplay} control={<Switch checked={prefs.similar} label={autoplay.title} onChange={prefs.onSimilar} />} />
      <SettingRow
        {...doubleClick}
        control={
          <Segmented
            label={doubleClick.title}
            options={choices(t, DOUBLE_CLICK, ["play", "queue"] as const)}
            value={prefs.doubleClick}
            onChange={prefs.onDoubleClick}
          />
        }
      />
      <SettingRow
        {...startContext}
        explained
        control={
          <Segmented
            label={startContext.title}
            options={choices(t, START_CONTEXT, ["resume", "empty"] as const)}
            value={prefs.startWith}
            onChange={prefs.onStartWith}
          />
        }
      />
      <SettingRow
        {...lyricsHighlight}
        explained
        control={
          <Segmented label={lyricsHighlight.title} options={choices(t, LYRICS_HIGHLIGHT, HIGHLIGHT_MODES)} value={highlightMode} onChange={setHighlightMode} />
        }
      />
      <SettingRow {...devicePause} control={<Switch checked={prefs.devicePause} label={devicePause.title} onChange={prefs.onDevicePause} />} />
      <CloseToTrayRow />
      <MenuEntryRow />
      <StatsPauseRow />
    </SettingGroup>
  );
}
