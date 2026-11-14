import { useEffect, useEffectEvent, useId, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import type { SheetAction } from "../../components/Sheet";
import { Tabs } from "../../components/Tabs";
import { TextField } from "../../components/TextField";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { ImportError, errorMessage, noticeMessage, type ImportActions, type ImportSummary, type ImportTarget, type Listing } from "../../ports/imports";
import { GlassSheet } from "../../sheets/GlassSheet";
import glass from "../../sheets/GlassSheet.module.css";
import { ImportPreview, type SongSearch } from "./ImportPreview";
import styles from "./ImportSheet.module.css";

export type ImportMode = "link" | "likes" | "file";

type Phase =
  | { kind: "idle" }
  | { kind: "listing"; count: number }
  | { kind: "preview"; listing: Listing }
  | { kind: "posting" }
  | { kind: "started"; summaries: ImportSummary[] }
  | { kind: "error"; error: unknown };

export interface ImportSheetProps {
  open: boolean;
  onClose(): void;
  actions: ImportActions;
  initialLink?: string;
  initialMode?: ImportMode;
  target?: ImportTarget;
  onStarted?(summaries: ImportSummary[]): void;
  note?: string | null;
  onOpenReport(importId: string): void;
  searchSongs?: SongSearch;
}

const FILE_TYPES = ".csv,.json,.m3u,.m3u8,.xspf,.txt";

export function ImportSheet({
  open,
  onClose,
  actions,
  initialLink,
  initialMode,
  target,
  onStarted,
  note,
  onOpenReport,
  searchSongs,
}: ImportSheetProps): JSX.Element | null {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ImportMode>(initialMode ?? "link");
  const [texts, setTexts] = useState<Record<"link" | "likes", string>>({
    link: initialLink ?? "",
    likes: "",
  });
  const textMode = mode === "likes" ? "likes" : "link";
  const text = texts[textMode];
  const setText = (value: string) => setTexts((current) => ({ ...current, [textMode]: value }));
  const [phase, setPhase] = useState<Phase>(initialLink ? { kind: "listing", count: 0 } : { kind: "idle" });
  const [chosen, setChosen] = useState<"new" | "liked">("new");
  const reading = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingId = useId();

  const stopReading = () => {
    reading.current?.abort(new DOMException("cancelled", "AbortError"));
    reading.current = null;
  };

  const start = (value: string, as: ImportMode) => {
    stopReading();
    const controller = new AbortController();
    reading.current = controller;
    const onProgress = (count: number) => {
      if (reading.current === controller) setPhase({ kind: "listing", count });
    };
    const listed = as === "likes" ? actions.listLikes(value, controller.signal, onProgress) : actions.list(value, controller.signal, onProgress);
    listed.then(
      (listing) => {
        if (reading.current === controller) setPhase({ kind: "preview", listing });
      },
      (error: unknown) => {
        // a cancel already moved the sheet back to the field
        if (reading.current === controller) setPhase({ kind: "error", error });
      },
    );
  };

  const read = (value: string, as: ImportMode) => {
    setPhase({ kind: "listing", count: 0 });
    start(value, as);
  };

  // the host mounts a fresh sheet per request, so a handed-over link is read once, on mount
  const readHandedOver = useEffectEvent(() => {
    if (initialLink) start(initialLink, "link");
  });
  const abandon = useEffectEvent(stopReading);
  useEffect(() => {
    readHandedOver();
    return () => abandon();
  }, []);

  const finish = (summaries: ImportSummary[]) => {
    setPhase({ kind: "started", summaries });
    onStarted?.(summaries);
  };

  const chosenTarget: ImportTarget | undefined = target ?? (chosen === "liked" ? { kind: "liked" } : undefined);

  const post = (listing: Listing) => {
    setPhase({ kind: "posting" });
    actions.post(listing, chosenTarget).then(finish, (error: unknown) => setPhase({ kind: "error", error }));
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setPhase({ kind: "posting" });
    actions.importFile(file, chosenTarget).then(finish, (error: unknown) => setPhase({ kind: "error", error }));
  };

  const close = () => {
    stopReading();
    onClose();
  };

  const reset = () => {
    stopReading();
    setPhase({ kind: "idle" });
  };

  const message = (m: { key: string; vars?: Record<string, string | number> }) => t(m.key, m.vars);

  const labelOf = (listing: Listing) =>
    listing.likesOf ? t("ui.imports.likes_name", { name: listing.likesOf }) : listing.label || t(`ui.imports.fallback.${listing.source}`);

  let buttons: SheetAction[] = [];
  let footerStart: JSX.Element | null = null;
  let body: JSX.Element;
  const title = (
    <h2 id={headingId} className={glass.title}>
      {t("ui.imports.title")}
    </h2>
  );

  switch (phase.kind) {
    case "listing":
      buttons = [{ label: t("ui.imports.cancel"), onClick: reset }];
      body = (
        <>
          {title}
          <p className={styles.line} role="status">
            {t("ui.imports.reading", { count: phase.count })}
          </p>
        </>
      );
      break;
    case "preview": {
      const { listing } = phase;
      buttons = [
        { label: t("ui.imports.cancel"), onClick: reset },
        { label: t("ui.imports.import"), onClick: () => post(listing), primary: true },
      ];
      footerStart = target ? null : (
        <div className={`${styles.segments} ${glass.start}`} role="group" aria-label={t("ui.imports.target")} data-chosen={chosen}>
          <span className={styles.thumb} aria-hidden="true" />
          {(["new", "liked"] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={chosen === kind} className={styles.segment} onClick={() => setChosen(kind)}>
              {t(kind === "new" ? "ui.imports.target_new" : "ui.imports.target_liked")}
            </button>
          ))}
        </div>
      );
      body = (
        <>
          <ImportPreview
            listing={listing}
            label={labelOf(listing)}
            headingId={headingId}
            search={searchSongs}
            notice={listing.notice ? message(noticeMessage(listing.notice, listing.source)) : undefined}
          />
          <p className={glass.caption}>{t("ui.imports.honesty")}</p>
        </>
      );
      break;
    }
    case "posting":
      buttons = [{ label: t("ui.imports.import"), onClick: () => {}, primary: true, disabled: true }];
      body = (
        <>
          {title}
          <p className={styles.line} role="status">
            {t("ui.imports.posting")}
          </p>
        </>
      );
      break;
    case "started": {
      const first = phase.summaries[0];
      buttons = [
        ...(first ? [{ label: t("ui.imports.open_report"), onClick: () => onOpenReport(first.id) }] : []),
        { label: t("ui.imports.done"), onClick: close, primary: true },
      ];
      body = (
        <>
          {title}
          <p className={styles.line} role="status">
            {t("ui.imports.started", { count: phase.summaries.length })}
          </p>
          {note ? (
            <p className={styles.line} role="status">
              {note}
            </p>
          ) : null}
        </>
      );
      break;
    }
    case "error": {
      const fileRoute = phase.error instanceof ImportError && (phase.error.code === "spotify_file_only" || phase.error.code === "region_blocked");
      buttons = [
        { label: t("ui.imports.close"), onClick: close },
        { label: t("ui.imports.try_again"), onClick: reset, primary: true },
      ];
      footerStart = fileRoute ? (
        <button
          type="button"
          className={`${glass.quiet} ${glass.start}`}
          onClick={() => {
            setMode("file");
            reset();
          }}
        >
          <Icon name="import" size={16} />
          {t("ui.imports.import_file_instead")}
        </button>
      ) : null;
      body = (
        <>
          {title}
          <p className={styles.line} role="alert">
            {message(errorMessage(phase.error))}
          </p>
        </>
      );
      break;
    }
    default:
      buttons =
        mode === "file"
          ? [
              { label: t("ui.imports.close"), onClick: close },
              { label: t("ui.imports.choose_file"), onClick: () => fileInput.current?.click(), primary: true },
            ]
          : [
              { label: t("ui.imports.close"), onClick: close },
              { label: t("ui.imports.read"), onClick: () => read(text, mode), primary: true, disabled: !text.trim() },
            ];
      body = (
        <>
          {title}
          <Tabs<ImportMode>
            items={[
              { id: "link", label: t("ui.imports.tab_link") },
              { id: "likes", label: t("ui.imports.tab_likes") },
              { id: "file", label: t("ui.imports.tab_file") },
            ]}
            value={mode}
            onChange={setMode}
            label={t("ui.imports.title")}
          />
          {mode === "file" ? (
            <>
              <p className={styles.line}>{t("ui.imports.file_hint")}</p>
              <input
                ref={fileInput}
                className={styles.file}
                type="file"
                accept={FILE_TYPES}
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
            </>
          ) : (
            <TextField
              value={text}
              onChange={setText}
              label={t(mode === "likes" ? "ui.imports.likes_label" : "ui.imports.link_label")}
              placeholder={t(mode === "likes" ? "ui.imports.likes_placeholder" : "ui.imports.link_placeholder")}
              onClear={() => setText("")}
              onSubmit={() => {
                if (text.trim()) read(text, mode);
              }}
              autoFocus
            />
          )}
        </>
      );
  }

  return (
    <GlassSheet open={open} onClose={close} labelledBy={headingId} width={phase.kind === "preview" ? 440 : 420}>
      {body}
      <div className={glass.footer}>
        {footerStart}
        {[...buttons]
          .sort((a, b) => Number(!!a.primary) - Number(!!b.primary))
          .map((action) => (
            <Button key={action.label} variant={action.primary ? "primary" : "secondary"} disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
      </div>
    </GlassSheet>
  );
}
