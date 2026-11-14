import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { LAYER_ATTRIBUTE, pushLayer, trapTab, usePresence } from "../../components/layers";
import { Lens } from "../../components/Lens";
import { Icon } from "../../icons/Icon";
import { HiddenList } from "../../recs/HiddenList";
import { loadAllLocales, useTranslation } from "../../ports/i18n";
import { useModalStore } from "../../ports/navigation";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { SearchQuery } from "./controls";
import { CustomizationSection } from "./CustomizationSection";
import { DiscordSection } from "./DiscordSection";
import { LastfmSection } from "./LastfmSection";
import { NetworkSection } from "./NetworkSection";
import { NotchSection } from "./NotchSection";
import { PlaybackSection } from "./PlaybackSection";
import { ClearGlyph, SectionIcon } from "./SectionIcon";
import { matchesQuery, matchingSections, sectionFromParam, SECTION_GROUPS, SECTION_ORDER, SECTIONS, type SectionId } from "./sections";
import { ShortcutsSection } from "./ShortcutsSection";
import { SoundSection } from "./SoundSection";
import { StorageSection } from "./StorageSection";
import { YoutubeSection } from "./YoutubeSection";
import styles from "./Settings.module.css";

const CONTENT: Record<SectionId, () => JSX.Element | null> = {
  Playback: PlaybackSection,
  Sound: SoundSection,
  Hidden: HiddenList,
  Shortcuts: ShortcutsSection,
  Appearance: AppearanceSection,
  Customization: CustomizationSection,
  Notch: NotchSection,
  Youtube: YoutubeSection,
  Lastfm: LastfmSection,
  Discord: DiscordSection,
  Storage: StorageSection,
  Network: NetworkSection,
  About: AboutSection,
};

export function Settings(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useModalStore((state) => state.settingsOpen);
  const requested = useModalStore((state) => state.settingsSection);
  const closeSettings = useModalStore((state) => state.closeSettings);
  const phase = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [chosen, setChosen] = useState<SectionId>("Playback");
  const [query, setQuery] = useState("");

  const [adopted, setAdopted] = useState<string | null>(null);
  const wanted = open ? requested : null;
  if (wanted !== adopted) {
    setAdopted(wanted);
    const id = sectionFromParam(wanted);
    if (id) setChosen(id);
  }

  const close = () => {
    setQuery("");
    closeSettings();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const pop = pushLayer(() => closeRef.current());
    return () => {
      pop();
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  // Runs after the layer effect, so the focus it restores on close is the one from before opening
  useEffect(() => {
    if (open) navRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [open, adopted]);

  useEffect(() => {
    if (open) void loadAllLocales();
  }, [open]);

  const searching = query.trim() !== "";
  const matches = useMemo(() => (searching ? matchingSections(query) : null), [searching, query]);
  const groups = SECTION_GROUPS.map((group) => ({ ...group, ids: matches ? group.ids.filter((id) => matches.has(id)) : group.ids })).filter(
    (group) => group.ids.length > 0,
  );
  const active = matches && !matches.has(chosen) ? (SECTION_ORDER.find((id) => matches.has(id)) ?? chosen) : chosen;
  const visible = groups.flatMap((group) => group.ids);
  const rowQuery = matchesQuery(query, [SECTIONS[active].labelKey, SECTIONS[active].descKey]) ? "" : query;

  const onNavKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || visible.length === 0) return;
    event.preventDefault();
    const next = visible[(visible.indexOf(active) + step + visible.length) % visible.length];
    setChosen(next);
    navRef.current?.querySelector<HTMLElement>(`[data-section="${next}"]`)?.focus();
  };

  if (phase === null) return null;
  const Content = CONTENT[active];

  return createPortal(
    <div className={styles.layer} data-state={phase} {...{ [LAYER_ATTRIBUTE]: "" }}>
      <div className={styles.backdrop} data-state={phase} onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={styles.panel}
        data-state={phase}
        onKeyDown={(event) => trapTab(event, event.currentTarget)}
      >
        <aside className={styles.aside}>
          <label className={styles.searchWrap}>
            <Icon name="search" size={16} />
            <input
              type="text"
              value={query}
              placeholder={t("settings.search_placeholder")}
              aria-label={t("settings.search_placeholder")}
              className={styles.search}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" className={styles.clear} aria-label={t("ui.clear")} onClick={() => setQuery("")}>
                <ClearGlyph />
              </button>
            ) : null}
          </label>

          <nav
            ref={navRef}
            className={`${styles.nav} n-scroll`}
            role="tablist"
            aria-orientation="vertical"
            aria-label={t("settings.title")}
            onKeyDown={onNavKey}
          >
            {groups.length === 0 ? (
              <p className={styles.noMatch}>{t("ui.settings.no_match", { query: query.trim() })}</p>
            ) : (
              groups.map((group) => (
                <div key={group.labelKey} className={styles.group}>
                  <p className={styles.groupLabel}>{t(group.labelKey)}</p>
                  <div className={styles.groupItems}>
                    {group.ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        data-section={id}
                        aria-selected={id === active}
                        tabIndex={id === active ? 0 : -1}
                        className={styles.item}
                        onClick={() => setChosen(id)}
                      >
                        {id === active ? <Lens group="settings-section" value={active} radius={10} className={styles.lens} /> : null}
                        <SectionIcon id={id} />
                        <span className={styles.itemLabel}>{t(SECTIONS[id].labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </nav>
        </aside>

        <div className={styles.main}>
          <div key={active} className={`${styles.body} n-scroll`} role="tabpanel" aria-labelledby="settings-title">
            <header className={styles.head}>
              <h2 id="settings-title" className={styles.title}>
                {t(SECTIONS[active].labelKey)}
              </h2>
              <p className={styles.description}>{t(SECTIONS[active].descKey)}</p>
            </header>
            <SearchQuery.Provider value={rowQuery}>
              <div className={styles.pane}>
                <Content />
              </div>
            </SearchQuery.Provider>
          </div>
          <button type="button" className={styles.close} aria-label={t("common.close")} onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
