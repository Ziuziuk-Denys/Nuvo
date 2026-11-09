import { useEffect, useEffectEvent, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Sheet, type SheetAction } from "../../components/Sheet";
import { Tabs } from "../../components/Tabs";
import { TextField } from "../../components/TextField";
import { useTranslation } from "../../ports/i18n";
import { ImportError, errorMessage, noticeMessage, type ImportActions, type ImportSummary, type ImportTarget, type Listing } from "../../ports/imports";
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
}

const PREVIEW_ROWS = 5;
const FILE_TYPES = ".csv,.json,.m3u,.m3u8";

export function ImportSheet({ open, onClose, actions, initialLink, initialMode, target, onStarted, note, onOpenReport }: ImportSheetProps): JSX.Element | null {
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

  let sheetActions: SheetAction[] = [];
  let body: JSX.Element;

  switch (phase.kind) {
    case "listing":
      sheetActions = [{ label: t("ui.imports.cancel"), onClick: reset }];
      body = (
        <p className={styles.line} role="status">
          {t("ui.imports.reading", { count: phase.count })}
        </p>
      );
      break;
    case "preview": {
      const { listing } = phase;
      sheetActions = [
        { label: t("ui.imports.cancel"), onClick: reset },
        {
          label: t("ui.imports.import"),
          onClick: () => post(listing),
          primary: true,
        },
      ];
      body = (
        <>
          <div>
            <h3 className={styles.heading}>{labelOf(listing)}</h3>
            <p className={styles.caption}>
              {t("ui.imports.songs", { count: listing.rows.length })} ·{" "}
              {t("ui.imports.from_source", {
                source: t(`ui.imports.source.${listing.source}`),
              })}
            </p>
          </div>
          {listing.notice ? <p className={styles.line}>{message(noticeMessage(listing.notice, listing.source))}</p> : null}
          <ul className={styles.rows}>
            {listing.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
              <li key={index}>{row.artists.length ? `${row.title} · ${row.artists.join(", ")}` : row.title}</li>
            ))}
          </ul>
          {target ? null : (
            <div className={styles.targets} role="group" aria-label={t("ui.imports.target")}>
              <Chip active={chosen === "new"} onClick={() => setChosen("new")}>
                {t("ui.imports.target_new")}
              </Chip>
              <Chip active={chosen === "liked"} onClick={() => setChosen("liked")}>
                {t("ui.imports.target_liked")}
              </Chip>
            </div>
          )}
          <p className={styles.caption}>{t("ui.imports.honesty")}</p>
        </>
      );
      break;
    }
    case "posting":
      sheetActions = [
        {
          label: t("ui.imports.import"),
          onClick: () => {},
          primary: true,
          disabled: true,
        },
      ];
      body = (
        <p className={styles.line} role="status">
          {t("ui.imports.posting")}
        </p>
      );
      break;
    case "started": {
      const first = phase.summaries[0];
      sheetActions = [
        ...(first
          ? [
              {
                label: t("ui.imports.open_report"),
                onClick: () => onOpenReport(first.id),
              },
            ]
          : []),
        { label: t("ui.imports.done"), onClick: close, primary: true },
      ];
      body = (
        <>
          <p className={styles.line} role="status">
            {t("ui.imports.started", { count: phase.summaries.length })}
          </p>
          {note ? (
            <p className={styles.line} role="status">
              {note}
            </p>
          ) : null}
          <p className={styles.caption}>{t("ui.imports.honesty")}</p>
        </>
      );
      break;
    }
    case "error": {
      const spotify = phase.error instanceof ImportError && phase.error.code === "spotify_file_only";
      sheetActions = [
        { label: t("ui.imports.close"), onClick: close },
        { label: t("ui.imports.try_again"), onClick: reset, primary: true },
      ];
      body = (
        <>
          <p className={styles.line} role="alert">
            {message(errorMessage(phase.error))}
          </p>
          {spotify ? (
            <Button
              variant="secondary"
              size="s"
              onClick={() => {
                setMode("file");
                reset();
              }}
            >
              {t("ui.imports.import_file_instead")}
            </Button>
          ) : null}
        </>
      );
      break;
    }
    default:
      sheetActions =
        mode === "file"
          ? [{ label: t("ui.imports.close"), onClick: close }]
          : [
              { label: t("ui.imports.close"), onClick: close },
              {
                label: t("ui.imports.read"),
                onClick: () => read(text, mode),
                primary: true,
                disabled: !text.trim(),
              },
            ];
      body = (
        <>
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
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                {t("ui.imports.choose_file")}
              </Button>
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
    <Sheet open={open} onClose={close} title={t("ui.imports.title")} actions={sheetActions}>
      <div className={styles.body}>{body}</div>
    </Sheet>
  );
}
