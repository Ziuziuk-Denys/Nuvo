import { useCallback, useRef, type CSSProperties, type JSX } from "react";
import { Icon } from "../../icons/Icon";
import { MEDIA_TYPES } from "../../mediaFiles";
import { useTranslation } from "../../ports/i18n";
import { partsFor, sceneThumbnail, SCENES, thumbnailOf, type Media, type Part, type Selection } from "../../ports/visual";
import theme from "./theme.module.css";
import type { Category } from "./types";
import { usePreview } from "./usePreview";
import styles from "./Assets.module.css";

interface AssetsProps {
  category: Category;
  selection: Selection;
  coverUrl: string;
  media: Media | null;
  isChosen(part: Part): boolean;
  onPart(part: Part): void;
  onScene(selection: Selection): void;
  onMedia(file: File): void;
  notice: string | null;
  full: boolean;
}

const same = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

function Tile({
  label,
  src,
  selected,
  onPick,
  index,
  dim,
}: {
  label: string;
  src: string;
  selected: boolean;
  onPick(): void;
  index: number;
  dim?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={styles.tile}
      data-dim={dim ? "" : undefined}
      style={{ "--i": Math.min(index, 12) } as CSSProperties}
      onClick={onPick}
    >
      <span className={styles.art}>
        {src ? <img src={src} alt="" /> : null}
        {selected ? <Icon name="check" size={14} className={styles.check} /> : null}
      </span>
      <span className={styles.name}>{label}</span>
    </button>
  );
}

function PartTile({
  part,
  coverUrl,
  media,
  selected,
  onPick,
  index,
  dim,
}: {
  part: Part;
  coverUrl: string;
  media: Media | null;
  selected: boolean;
  onPick(): void;
  index: number;
  dim: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const src = usePreview(useCallback(() => thumbnailOf(part, coverUrl, media), [part, coverUrl, media]));
  return <Tile label={t(`visual.part.${part.id}.title`)} src={src} selected={selected} onPick={onPick} index={index} dim={dim} />;
}

function SceneTile({
  id,
  selection,
  coverUrl,
  media,
  selected,
  onPick,
  index,
}: {
  id: string;
  selection: Selection;
  coverUrl: string;
  media: Media | null;
  selected: boolean;
  onPick(): void;
  index: number;
}): JSX.Element {
  const { t } = useTranslation();
  const src = usePreview(useCallback(() => sceneThumbnail(selection, id, coverUrl, media), [selection, id, coverUrl, media]));
  return <Tile label={t(`visual.scene.${id}`)} src={src} selected={selected} onPick={onPick} index={index} />;
}

export function Assets({ category, selection, coverUrl, media, isChosen, onPart, onScene, onMedia, notice, full }: AssetsProps): JSX.Element {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const title = t(`visual.studio.rail_${category}`);
  const slot = category === "scenes" || category === "media" ? null : category;

  return (
    <section className={styles.assets} aria-label={title}>
      <div className={styles.notice} role="status" data-shown={notice ? "" : undefined}>
        {notice}
      </div>
      {category === "media" ? (
        <div className={styles.media}>
          <button type="button" className={styles.drop} onClick={() => file.current?.click()}>
            <Icon name="import" size={24} />
            <b>{t("visual.studio.import")}</b>
            <span>{t("visual.studio.import_hint")}</span>
          </button>
          <input
            ref={file}
            type="file"
            accept={MEDIA_TYPES}
            hidden
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0];
              if (picked) onMedia(picked);
              event.currentTarget.value = "";
            }}
          />
          {selection.background === "media" && media ? <p className={theme.hint}>{t("visual.studio.media_in_use")}</p> : null}
        </div>
      ) : (
        <div key={category} className={`${styles.grid} n-scroll`} role="listbox" aria-label={title}>
          {category === "scenes"
            ? SCENES.map((item, index) => (
                <SceneTile
                  key={item.id}
                  index={index}
                  id={item.id}
                  selection={item.selection}
                  coverUrl={coverUrl}
                  media={media}
                  selected={same(item.selection, selection)}
                  onPick={() => onScene(item.selection)}
                />
              ))
            : null}
          {slot
            ? partsFor(slot)
                .filter((part) => part.id !== "media" || media)
                .map((part, index) => {
                  const chosen = isChosen(part);
                  return (
                    <PartTile
                      key={part.id}
                      index={index}
                      part={part}
                      coverUrl={coverUrl}
                      media={media}
                      selected={chosen}
                      dim={full && !chosen}
                      onPick={() => onPart(part)}
                    />
                  );
                })
            : null}
        </div>
      )}
    </section>
  );
}
