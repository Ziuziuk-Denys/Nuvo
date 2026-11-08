import { useEffect, useState, type JSX } from "react";
import { Cover } from "../components/Cover";
import { useTranslation } from "../ports/i18n";
import { recs, type Suppression } from "../ports/recs";
import { SettingGroup, SettingRow } from "../screens/settings/controls";
import { ExcludedPlaylists } from "./ExcludedPlaylists";
import { hiddenLine, hiddenTitle } from "./hiddenText";
import styles from "./HiddenList.module.css";

/** Settings section: everything "Not interested" hides, then the playlists left out of recommendations. */
export function HiddenList(): JSX.Element {
  return (
    <>
      <HiddenMusic />
      <ExcludedPlaylists />
    </>
  );
}

/** Everything "Not interested" hides, newest first, how long each lasts and its own Show again. */
function HiddenMusic(): JSX.Element | null {
  const { t } = useTranslation();
  const [items, setItems] = useState<Suppression[] | "failed" | null>(null);
  const [undoFailed, setUndoFailed] = useState(false);
  // months are counted from when the section opened
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void recs.suppressions().then((result) => {
      if (live) setItems(Array.isArray(result) ? result : "failed");
    });
    return () => {
      live = false;
    };
  }, []);

  const showAgain = async (item: Suppression) => {
    const result = await recs.undo(item.id);
    setUndoFailed(result !== true);
    if (result === true) setItems((list) => (Array.isArray(list) ? list.filter((other) => other.id !== item.id) : list));
  };

  if (items === null) return null;
  if (items === "failed") return <p className={styles.line}>{t("ui.recs.hidden.failed")}</p>;
  if (items.length === 0) return <p className={styles.line}>{t("ui.recs.hidden.empty")}</p>;
  return (
    <SettingGroup>
      {undoFailed ? (
        <p className={styles.line} role="status">
          {t("ui.recs.notice.undo_failed")}
        </p>
      ) : null}
      {items.map((item) => {
        const artist = item.scope === "artist" || item.scope === "artist_forever";
        return (
          <SettingRow
            key={item.id}
            icon={<Cover src={item.track?.coverUrl ?? ""} size={32} shape={artist ? "circle" : "square"} radius={artist ? undefined : 6} />}
            title={hiddenTitle(item, t)}
            description={hiddenLine(item, now, t)}
            explained
            control={
              <button type="button" className={styles.undo} onClick={() => void showAgain(item)}>
                {t("ui.recs.hidden.undo")}
              </button>
            }
          />
        );
      })}
    </SettingGroup>
  );
}
