import type { CSSProperties, JSX } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";
import { useWarmup, warmHome } from "../../ports/recs";
import { useAddFolder, useAddMusic } from "../local/addMusic";
import { useImportsUi } from "../imports/importsUi";
import styles from "./ColdStart.module.css";

const OUTLINE_CARDS = 4;

function Building(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.building} role="status" data-building="">
      <div className={styles.outline} aria-hidden="true">
        {Array.from({ length: OUTLINE_CARDS }, (_, index) => (
          <span key={index} className={styles.card} data-lead={index === 0 ? "" : undefined} style={{ "--i": index } as CSSProperties} />
        ))}
      </div>
      <p className={styles.note}>{t("ui.recs.home.building")}</p>
    </div>
  );
}

function BringMusic(): JSX.Element {
  const { t } = useTranslation();
  const addMusic = useAddMusic();
  const addFolder = useAddFolder();
  return (
    <section className={styles.bring} aria-labelledby="bring-title" data-bring="">
      <h2 id="bring-title" className={styles.title}>
        {t("ui.home.bring.title")}
      </h2>
      <p className={styles.message}>{t("ui.home.bring.message")}</p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => useImportsUi.getState().openImport()}>
          {t("ui.library.import")}
        </Button>
        <Button onClick={() => void addMusic()}>{t("ui.local.add_files")}</Button>
        <Button variant="text" onClick={() => void addFolder()}>
          {t("ui.local.add_folder")}
        </Button>
      </div>
    </section>
  );
}

export function ColdStart(): JSX.Element {
  const { t } = useTranslation();
  const warmup = useWarmup((state) => state.phase);
  if (warmup === "building") return <Building />;
  if (warmup === "failed") {
    return (
      <EmptyState
        title={t("ui.recs.home.offline_title")}
        message={t("ui.recs.home.offline_message")}
        actions={[
          { label: t("ui.recs.home.retry"), primary: true, onClick: () => void warmHome(useWarmup.getState().seeds) },
          { label: t("ui.recs.home.search"), onClick: () => useModalStore.getState().openSearch() },
        ]}
      />
    );
  }
  return <BringMusic />;
}
