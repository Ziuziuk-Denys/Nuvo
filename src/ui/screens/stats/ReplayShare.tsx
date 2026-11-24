import { useEffect, useId, useMemo, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { ModalPanel } from "../../components/ModalPanel";
import { useToastStore } from "../../feedback/toastStore";
import { useTranslation } from "../../ports/i18n";
import type { StatsOverview } from "../../ports/stats";
import look from "../look.module.css";
import { renderReplayImage, type ReplayCard, type ReplayFormat, type ReplayImage } from "./replayImage";
import { minutesOf, type ReplayPeriod } from "./replayModel";
import { dayProfile, filled, MIN_CHART_BUCKETS, peakIndex } from "./statsModel";
import styles from "./ReplayShare.module.css";

const FORMATS: readonly ReplayFormat[] = ["story", "square"];
const REVOKE_MS = 1_000;

function usePictures(
  stats: StatsOverview,
  period: ReplayPeriod,
  name: string,
): { cards: ReplayCard[]; picture: (card: ReplayCard, format: ReplayFormat) => ReplayImage } {
  const { t, locale } = useTranslation();
  return useMemo(() => {
    const top = stats.top.tracks[0];
    const minutes = minutesOf(stats.totals.listenedMs);
    const lead = dayProfile(stats.byHour).reduce((best, item) => (item.share > best.share ? item : best));
    const title =
      period.kind === "all" ? t("ui.stats.range_all") : period.kind === "month" ? `${name.replace(/ \d{4}$/, "")} ${period.from.slice(0, 4)}` : name;
    const cards: ReplayCard[] = [...(top ? (["song"] as const) : []), "time", ...(filled(stats.byHour) >= MIN_CHART_BUCKETS ? (["hours"] as const) : [])];
    const picture = (card: ReplayCard, format: ReplayFormat): ReplayImage => ({
      card,
      format,
      font: getComputedStyle(document.body).fontFamily || "system-ui",
      period: title,
      minutes: minutes.toLocaleString(locale),
      minutesLine: t("ui.replay.minutes_short", { count: minutes }),
      song: { title: top?.title ?? "", artist: top?.subtitle ?? "", plays: t("ui.stats.plays", { count: top?.plays ?? 0 }), cover: top?.coverUrl ?? "" },
      list: stats.top.tracks.slice(0, 5).map((row) => ({ title: row.title, artist: row.subtitle ?? "", cover: row.coverUrl ?? "" })),
      byHour: stats.byHour,
      hour: `${String(peakIndex(stats.byHour)).padStart(2, "0")}:00`,
      hourLine: t(`ui.stats.part.${lead.part}.listener`),
      madeWith: t("ui.replay.made_with"),
    });
    return { cards, picture };
  }, [stats, period, name, t, locale]);
}

const pngOf = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png"));

export function ReplayShare({ stats, period, name, onClose }: { stats: StatsOverview; period: ReplayPeriod; name: string; onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { cards, picture } = usePictures(stats, period, name);
  const [card, setCard] = useState<ReplayCard>(cards[0]);
  const [format, setFormat] = useState<ReplayFormat>("story");
  const [drawn, setDrawn] = useState(false);
  const toast = useToastStore.getState().show;

  useEffect(() => {
    if (!canvas.current) return;
    let live = true;
    const next = document.createElement("canvas");
    void renderReplayImage(next, picture(card, format)).then(() => {
      const shown = canvas.current;
      if (!live || !shown) return;
      shown.width = next.width;
      shown.height = next.height;
      shown.getContext("2d")?.drawImage(next, 0, 0);
      setDrawn(true);
    });
    return () => {
      live = false;
    };
  }, [card, format, picture]);

  const save = async () => {
    if (!canvas.current) return;
    const url = URL.createObjectURL(await pngOf(canvas.current));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Nuvo ${name || t("ui.stats.range_all")} ${t(`ui.replay.format_${format}`)}.png`.replace(/[\\/:*?"<>|]+/g, " ");
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
  };

  const copy = () => {
    if (!canvas.current) return;
    navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(canvas.current) })]).then(
      () => toast({ message: t("ui.replay.copied"), variant: "success" }),
      () => toast({ message: t("ui.replay.copy_failed"), variant: "error" }),
    );
  };

  return (
    <ModalPanel open onClose={onClose} labelledBy={headingId} classes={styles}>
      <div className={styles.stage} data-format={format}>
        <canvas ref={canvas} className={styles.canvas} data-drawn={drawn ? "" : undefined} role="img" aria-label={t(`ui.replay.card_${card}`)} />
      </div>
      <div className={styles.side}>
        <h2 id={headingId} className={styles.title}>
          {t("ui.replay.share_title")}
        </h2>
        <div className={styles.group} role="radiogroup" aria-label={t("ui.replay.card")}>
          {cards.map((item) => (
            <button key={item} type="button" role="radio" aria-checked={item === card} className={styles.option} onClick={() => setCard(item)}>
              {t(`ui.replay.card_${item}`)}
            </button>
          ))}
        </div>
        <div className={styles.group} role="radiogroup" aria-label={t("ui.replay.format")}>
          {FORMATS.map((item) => (
            <button key={item} type="button" role="radio" aria-checked={item === format} className={styles.option} onClick={() => setFormat(item)}>
              {t(`ui.replay.format_${item}`)}
              <span>{t(`ui.replay.format_${item}_size`)}</span>
            </button>
          ))}
        </div>
        <p className={styles.note}>{t("ui.replay.share_note")}</p>
        <div className={styles.actions}>
          <Button variant="primary" disabled={!drawn} onClick={() => void save()}>
            {t("ui.replay.save_image")}
          </Button>
          <button type="button" className={`${look.pill} ${look.glass}`} disabled={!drawn} onClick={copy}>
            {t("ui.replay.copy_image")}
          </button>
        </div>
      </div>
    </ModalPanel>
  );
}
