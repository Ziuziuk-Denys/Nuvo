import { useState, type JSX, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { Cover } from "../../components/Cover";
import { EmptyState } from "../../components/EmptyState";
import { Enter } from "../../components/Enter";
import { IconButton } from "../../components/IconButton";
import { LAYER_ATTRIBUTE } from "../../components/layers";
import { Menu, useContextMenu, type MenuItem } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { Row, RowPlaceholder } from "../../components/Row";
import { Sheet } from "../../components/Sheet";
import { Slider } from "../../components/Slider";
import { Tabs } from "../../components/Tabs";
import { TextField } from "../../components/TextField";
import { Toggle } from "../../components/Toggle";
import { useCalmLight } from "../../field/calm";
import { CONTENT, ISLAND, TOP_BAR } from "../../geometry";
import { Icon } from "../../icons/Icon";
import { ICON_NAMES } from "../../icons";
import { usePageBackdrop } from "../../ports/backdrop";
import { useCustomizationStore } from "../../ports/settings";
import { PRESETS, useLook, useSetThemeMode, useThemeMode, type ThemeMode } from "../../ports/theme";
import typeStyles from "../../type.module.css";
import styles from "./Specimen.module.css";
import {
  BROKEN_COVER,
  COLOUR_ROLES,
  COVERS,
  LONG_RU,
  PRESET_NAMES,
  TYPE_ROLES,
  formatColour,
  ratio,
  usePrefersReducedMotion,
  useRootTokens,
  type ColourRole,
  type RootTokens,
} from "./specimenData";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** The hidden #/specimen route: every Nuvo foundation on the live field, in the active look. */
export function Specimen(): JSX.Element {
  return (
    <div
      className={styles.page}
      style={{
        maxWidth: CONTENT.maxWidth + TOP_BAR.gutter * 2,
        paddingInline: TOP_BAR.gutter,
        paddingBottom: CONTENT.bottomPadding,
      }}
    >
      <Head />
      <TypeSection />
      <ColourSection />
      <BloomSection />
      <ControlsSection />
      <OverlaysSection />
      <MotionSection />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`specimen-${id}`} data-section={id}>
      <h2 id={`specimen-${id}`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A caption in the left rail and the samples beside it. */
function Group({ label, children, inset }: { label: string; children: ReactNode; inset?: "chip" }) {
  return (
    <div className={styles.group}>
      <span className={styles.rail}>{label}</span>
      <div className={[styles.content, inset ? styles.chipInset : ""].join(" ")}>{children}</div>
    </div>
  );
}

function Head() {
  const look = useLook();
  const themeMode = useThemeMode();
  const setThemeMode = useSetThemeMode();
  const setPreset = useCustomizationStore((s) => s.setPreset);
  const modes = PRESETS.find((preset) => preset.id === look.preset)?.modes ?? ["light", "dark"];
  const single = modes.length === 1;
  return (
    <header className={styles.head}>
      <h1 className={typeStyles.display}>Specimen</h1>
      <p className={styles.lede}>Every Nuvo foundation on the live field. Pick a look and the whole page follows it.</p>
      <div className={styles.switcher}>
        <Group label="Preset" inset="chip">
          <div className={styles.chips}>
            {PRESETS.map((preset) => (
              <Chip key={preset.id} active={look.preset === preset.id} onClick={() => setPreset(preset.id)}>
                {PRESET_NAMES[preset.id]}
              </Chip>
            ))}
          </div>
        </Group>
        <Group label="Mode" inset="chip">
          <div className={styles.chips}>
            {MODES.map((mode) => (
              <Chip
                key={mode.id}
                active={single ? mode.id === modes[0] : themeMode === mode.id}
                disabled={single && mode.id !== modes[0]}
                onClick={() => setThemeMode(mode.id)}
              >
                {mode.label}
              </Chip>
            ))}
            {single ? (
              <span className={styles.note}>
                {PRESET_NAMES[look.preset]} is {modes[0]} only
              </span>
            ) : null}
          </div>
        </Group>
      </div>
    </header>
  );
}

function TypeSection() {
  return (
    <Section id="type" title="Type">
      <div className={styles.stack}>
        {TYPE_ROLES.map((role) => (
          <div key={role.id} className={[styles.group, styles.typeRow].join(" ")}>
            <span className={styles.spec}>
              <span className={styles.specName}>{role.id}</span>
              <span className={styles.specValue}>{role.spec}</span>
            </span>
            <div className={styles.samples}>
              <span className={[typeStyles[role.id], styles.sample].join(" ")}>{role.sample}</span>
              <span className={[typeStyles[role.id], styles.sample].join(" ")}>{role.russian}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const INKS: ColourRole[] = ["ink", "ink-2", "ink-3"];

function Contrast({ tokens, role }: { tokens: RootTokens; role: ColourRole }) {
  const onField = ratio(tokens[role], tokens.field);
  if (role === "accent") return <Ratio label="field" value={onField} floor={3} />;
  if (!INKS.includes(role)) return null;
  return (
    <>
      <Ratio label="field" value={onField} floor={4.5} />
      <Ratio label="raised" value={ratio(tokens[role], tokens.raised)} floor={4.5} />
    </>
  );
}

function Ratio({ label, value, floor }: { label: string; value: number | null; floor: number }) {
  if (value === null) return null;
  return (
    <span className={styles.ratio} data-low={value < floor ? "" : undefined}>
      {value.toFixed(1)} <span className={styles.ratioLabel}>{label}</span>
    </span>
  );
}

function ColourSection() {
  const tokens = useRootTokens();
  return (
    <Section id="colour" title="Colour">
      <div className={styles.swatches}>
        {COLOUR_ROLES.map(({ id, role }) => (
          <div key={id} className={styles.swatchRow} data-swatch={id}>
            <span className={styles.swatch} style={{ background: `var(--n-${id})` }} />
            <span className={styles.swatchName}>
              <span className={styles.specName}>--n-{id}</span>
              <span className={styles.specValue}>{role}</span>
            </span>
            <span className={styles.swatchValue}>{formatColour(tokens[id])}</span>
            <span className={styles.ratios}>
              <Contrast tokens={tokens} role={id} />
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CalmLight() {
  useCalmLight();
  return null;
}

function BloomSection() {
  const [cover, setCover] = useState<string | undefined>(undefined);
  const [calm, setCalm] = useState(false);
  usePageBackdrop(cover);
  return (
    <Section id="bloom" title="Bloom">
      <div className={styles.stackWide}>
        <Group label="Light source">
          <div className={styles.covers}>
            {COVERS.map((item) => (
              <button key={item.id} type="button" className={styles.coverButton} aria-pressed={cover === item.url} onClick={() => setCover(item.url)}>
                <Cover src={item.url} size={56} />
                <span className={styles.coverName}>{item.name}</span>
              </button>
            ))}
          </div>
          <div className={styles.line}>
            <Button size="s" disabled={cover === undefined} onClick={() => setCover(undefined)}>
              Brand light
            </Button>
            <span className={styles.note}>
              {cover === undefined ? "No page cover: the playing track lights the field, else the brand light." : "Lit by the cover above."}
            </span>
          </div>
        </Group>
        <Group label="Strength">
          <div className={styles.narrow}>
            <Toggle checked={calm} onChange={setCalm} label="Calm light, as on Search and Settings" />
            {calm ? <CalmLight /> : null}
            <p className={styles.note}>The light crossfades over 900 ms. Violet turns to the edge of the purple band in every preset but Amethyst.</p>
          </div>
        </Group>
      </div>
    </Section>
  );
}

const noop = () => undefined;
const SPEEDS = ["0.75×", "1×", "1.25×", "1.5×"];
const SOUND_TABS = [
  { id: "eq", label: "Equalizer" },
  { id: "speed", label: "Speed" },
  { id: "sleep", label: "Sleep" },
] as const;
type SoundTab = (typeof SOUND_TABS)[number]["id"];

function ControlsSection() {
  const [speed, setSpeed] = useState("1×");
  const [toggles, setToggles] = useState({ track: true, artist: false });
  const [tab, setTab] = useState<SoundTab>("eq");
  const [query, setQuery] = useState("");
  const [artist, setArtist] = useState("Northern Lights");
  const [big, setBig] = useState("");
  const [volume, setVolume] = useState(64);
  const [rate, setRate] = useState(1);
  return (
    <Section id="controls" title="Controls">
      <div className={styles.stackWide}>
        <Group label="Buttons">
          <div className={styles.line}>
            <Button variant="primary">Play</Button>
            <Button>Shuffle</Button>
            <Button variant="text">Clear</Button>
            <Button variant="primary" disabled>
              Play
            </Button>
          </div>
          <div className={styles.line}>
            <Button variant="primary" size="s">
              Resume
            </Button>
            <Button size="s">Start radio</Button>
            <Button variant="text" size="s">
              Change
            </Button>
            <Button size="s" disabled>
              Import
            </Button>
          </div>
        </Group>
        <Group label="Icon buttons">
          <div className={styles.line}>
            <IconButton icon="like" label="Like" />
            <IconButton icon="liked" label="Liked" active />
            <IconButton icon="queue" label="Queue" />
            <IconButton icon="shuffle" label="Shuffle" active />
            <IconButton icon="more" label="More" size="s" />
            <IconButton icon="trash" label="Remove" disabled />
          </div>
        </Group>
        <Group label="Island tone">
          <div className={styles.island} style={{ height: ISLAND.height, borderRadius: ISLAND.radius }}>
            <IconButton icon="previous" label="Previous" tone="island" />
            <IconButton icon="next" label="Next" tone="island" />
            <IconButton icon="liked" label="Liked" tone="island" active />
            <IconButton icon="playlist-add" label="Add to playlist" tone="island" />
            <IconButton icon="equalizer" label="Sound" tone="island" />
            <IconButton icon="volume-high" label="Volume" tone="island" />
            <IconButton icon="queue" label="Queue" tone="island" />
          </div>
        </Group>
        <Group label="Chips" inset="chip">
          <div className={styles.chips}>
            {SPEEDS.map((value) => (
              <Chip key={value} active={speed === value} onClick={() => setSpeed(value)}>
                {value}
              </Chip>
            ))}
            <Chip active={false} disabled>
              2×
            </Chip>
          </div>
        </Group>
        <Group label="Toggles">
          <div className={styles.narrow}>
            <Toggle checked={toggles.track} onChange={(track) => setToggles({ ...toggles, track })} label="Remember for this track" />
            <Toggle checked={toggles.artist} onChange={(value) => setToggles({ ...toggles, artist: value })} label="Remember for this artist" />
            <Toggle checked={false} onChange={noop} label="Crossfade (needs a restart)" disabled />
          </div>
        </Group>
        <Group label="Tabs" inset="chip">
          <Tabs items={[...SOUND_TABS]} value={tab} onChange={setTab} label="Sound" />
        </Group>
        <Group label="Text fields">
          <div className={styles.narrowStack}>
            <TextField label="Filter" placeholder="Filter" value={query} onChange={setQuery} onClear={() => setQuery("")} />
            <TextField label="Artist" value={artist} onChange={setArtist} onClear={() => setArtist("")} />
            <TextField label="Search" size="l" placeholder="Songs, albums, artists" value={big} onChange={setBig} onClear={() => setBig("")} />
          </div>
        </Group>
        <Group label="Sliders">
          <div className={styles.narrowStack}>
            <Slider label="Volume" value={volume} min={0} max={100} step={1} onChange={setVolume} format={(value) => `${value}%`} />
            <Slider label="Speed" value={rate} min={0.5} max={2} step={0.05} onChange={setRate} format={(value) => `${value.toFixed(2)}×`} />
          </div>
        </Group>
        <Group label="Rows">
          <div className={styles.rows}>
            <Row
              leading={<Cover src={COVERS[0].url} size={40} />}
              title="Late night drive"
              subtitle="Playlist · 48 tracks"
              meta="48"
              actions={<IconButton icon="more" label="More" size="s" />}
              onActivate={noop}
            />
            <Row
              variant="track"
              leading={1}
              title="Midnight Ferry"
              subtitle="Northern Lights"
              meta="3:42"
              actions={
                <>
                  <IconButton icon="like" label="Like" size="s" />
                  <IconButton icon="more" label="More" size="s" />
                </>
              }
              onActivate={noop}
            />
            <Row variant="track" leading={2} title="Glass Harbour" subtitle="Velvet Hour" meta="4:05" active onActivate={noop} />
            <Row
              variant="track"
              leading={3}
              title="Removed by the uploader"
              subtitle="Unknown artist"
              meta="3:30"
              unavailableReason="Not available offline"
              onActivate={noop}
            />
            <Row variant="track" leading={4} title={LONG_RU} subtitle="Дорожный патруль" meta="12:07" onActivate={noop} />
            <Row variant="compact" leading={<Cover src={COVERS[4].url} size={24} />} title="Liked songs" meta="1 204" onActivate={noop} />
          </div>
        </Group>
        <Group label="Covers">
          <div className={styles.coverLine}>
            <Cover src={COVERS[1].url} size={200} />
            <Cover src={COVERS[5].url} size={160} />
            <Cover src={COVERS[2].url} size={160} shape="circle" />
            <Cover src={COVERS[0].url} size={40} />
            <Cover src={BROKEN_COVER} size={40} />
          </div>
          <p className={styles.note}>200, 160, artist circle, 40, and a cover that failed to load.</p>
        </Group>
        <Group label="Loading">
          <div className={styles.rows}>
            <RowPlaceholder />
            <RowPlaceholder variant="track" leading="index" />
            <RowPlaceholder variant="compact" />
          </div>
        </Group>
        <Group label="Empty">
          <EmptyState
            title="No liked songs yet"
            message="Like a song and it lands here, ready to play."
            actions={[
              { label: "Import", onClick: noop },
              { label: "Search", onClick: noop, primary: true },
            ]}
          />
        </Group>
        <Group label="Icons">
          <div className={styles.icons}>
            {ICON_NAMES.map((name) => (
              <span key={name} className={styles.icon} title={name}>
                <Icon name={name} size={20} />
              </span>
            ))}
          </div>
          <div className={styles.line}>
            {([16, 20, 24] as const).map((size) => (
              <span key={size} className={styles.iconSize}>
                <Icon name="play" size={size} />
                <span className={styles.specValue}>{size}</span>
              </span>
            ))}
          </div>
        </Group>
      </div>
    </Section>
  );
}

const EQ_PRESETS = ["Flat", "Bass", "Vocal", "Bright", "Night"];
const SLEEP_TIMES = ["15 min", "30 min", "1 h", "End of track"];
const TRACK_MENU: MenuItem[] = [
  { label: "Play next", onSelect: noop },
  { label: "Add to queue", onSelect: noop },
  { label: "Go to artist", onSelect: noop },
  "separator",
  { label: "Download for offline", onSelect: noop, disabled: true },
  { label: "Remove from library", onSelect: noop, danger: true },
];

type IslandPopover = "sound" | "volume";

function OverlaysSection() {
  const [open, setOpen] = useState(false);
  // kept through the exit, so the content does not switch while it fades out
  const [shown, setShown] = useState<IslandPopover>("sound");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState<SoundTab>("eq");
  const [eqOn, setEqOn] = useState(true);
  const [preset, setPreset] = useState("Flat");
  const [speed, setSpeed] = useState("1×");
  const [rate, setRate] = useState(1);
  const [sleep, setSleep] = useState("30 min");
  const [volume, setVolume] = useState(64);
  const [remember, setRemember] = useState({ track: true, artist: false });
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const context = useContextMenu();

  // the caller's toggle: the same button closes, the other one moves the open popover over to it
  const toggle = (next: IslandPopover, target: HTMLElement) => {
    if (open && shown === next) {
      setOpen(false);
      return;
    }
    setShown(next);
    setAnchor(target);
    setOpen(true);
  };
  const wide = shown === "sound" && tab === "eq";
  const closeSheet = () => setSheet(false);

  const rememberToggles = (
    <div className={styles.popoverGroup}>
      <Toggle checked={remember.track} onChange={(track) => setRemember({ ...remember, track })} label="Remember for this track" />
      <Toggle checked={remember.artist} onChange={(artist) => setRemember({ ...remember, artist })} label="Remember for this artist" />
    </div>
  );

  return (
    <Section id="overlays" title="Overlays">
      <div className={styles.stackWide}>
        <Group label="Popover">
          {/* presses on these anchors never count as outside: they toggle or move the popover */}
          <div className={styles.line} {...{ [LAYER_ATTRIBUTE]: "" }}>
            <Button aria-expanded={open && shown === "sound"} onClick={(event) => toggle("sound", event.currentTarget)}>
              Sound
            </Button>
            <Button aria-expanded={open && shown === "volume"} onClick={(event) => toggle("volume", event.currentTarget)}>
              Volume
            </Button>
          </div>
          <p className={styles.note}>
            One container for the family. Switch between Sound and Volume, or from Equalizer to Speed, and it morphs from 560 to 320 px.
          </p>
          <Popover
            open={open}
            anchor={anchor}
            width={wide ? 560 : 320}
            title={shown === "sound" ? "Sound" : "Volume"}
            trailing={wide ? <Toggle checked={eqOn} onChange={setEqOn} label="On" /> : undefined}
            onClose={() => setOpen(false)}
          >
            {shown === "volume" ? (
              <Slider label="Volume" value={volume} min={0} max={100} step={1} onChange={setVolume} format={(value) => `${value}%`} />
            ) : (
              <div className={styles.popoverBody}>
                <Tabs items={[...SOUND_TABS]} value={tab} onChange={setTab} label="Sound" />
                {tab === "eq" ? (
                  <>
                    <div className={styles.chips}>
                      {EQ_PRESETS.map((value) => (
                        <Chip key={value} active={preset === value} disabled={!eqOn} onClick={() => setPreset(value)}>
                          {value}
                        </Chip>
                      ))}
                    </div>
                    {rememberToggles}
                  </>
                ) : null}
                {tab === "speed" ? (
                  <>
                    <div className={styles.chips}>
                      {SPEEDS.map((value) => (
                        <Chip key={value} active={speed === value} onClick={() => setSpeed(value)}>
                          {value}
                        </Chip>
                      ))}
                    </div>
                    <Slider label="Speed" value={rate} min={0.5} max={2} step={0.05} onChange={setRate} format={(value) => `${value.toFixed(2)}×`} />
                    {rememberToggles}
                  </>
                ) : null}
                {tab === "sleep" ? (
                  <div className={styles.chips}>
                    {SLEEP_TIMES.map((value) => (
                      <Chip key={value} active={sleep === value} onClick={() => setSleep(value)}>
                        {value}
                      </Chip>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </Popover>
        </Group>
        <Group label="Sheet">
          <div className={styles.line}>
            <Button onClick={() => setSheet(true)}>New playlist</Button>
          </div>
          <Sheet
            open={sheet}
            onClose={closeSheet}
            title="New playlist"
            actions={[
              { label: "Create", onClick: closeSheet, primary: true, disabled: name.trim() === "" },
              { label: "Cancel", onClick: closeSheet },
            ]}
          >
            <div className={styles.sheetBody}>
              <p className={styles.sheetText}>Give it a name. You can change it later.</p>
              <TextField label="Name" placeholder="Playlist name" value={name} onChange={setName} onClear={() => setName("")} />
            </div>
          </Sheet>
        </Group>
        <Group label="Menu">
          <div className={styles.line}>
            <IconButton
              icon="more"
              label="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(event) => {
                setMenuAnchor(event.currentTarget);
                setMenuOpen(!menuOpen);
              }}
            />
          </div>
          <Menu open={menuOpen} anchor={menuAnchor} onClose={() => setMenuOpen(false)} items={TRACK_MENU} />
          <div className={styles.rows}>
            <Row
              variant="track"
              leading={1}
              title="Midnight Ferry"
              subtitle="Right-click for the same menu at the pointer"
              meta="3:42"
              onContextMenu={(event) => context.open(event, TRACK_MENU)}
            />
          </div>
          {context.element}
        </Group>
      </div>
    </Section>
  );
}

function MotionSection() {
  const [run, setRun] = useState(0);
  const reduced = usePrefersReducedMotion();
  const screen = `specimen-entrance-${run}`;
  return (
    <Section id="motion" title="Motion">
      <div className={styles.stackWide}>
        <Group label="Controls">
          <div className={styles.line}>
            <Button onClick={() => setRun(run + 1)}>Replay entrance</Button>
            <Button variant="primary">Press and hold</Button>
          </div>
          <p className={styles.note}>
            {reduced
              ? "Reduced motion is on: no movement, fades of 160 ms, no stagger."
              : "Reduced motion is off: sections rise 16 px and settle over 560 ms, 60 ms apart."}
          </p>
        </Group>
        <Group label="Entrance">
          <div key={run} className={styles.stage}>
            <Enter index={0} screen={screen}>
              <p className={typeStyles.display}>Listen</p>
            </Enter>
            <Enter index={1} screen={screen}>
              <p className={styles.lede}>Last played: Late night drive</p>
            </Enter>
            <Enter index={2} screen={screen}>
              <div className={styles.continue}>
                <Cover src={COVERS[1].url} size={120} />
                <div className={styles.continueText}>
                  <span className={typeStyles.heading}>Late night drive</span>
                  <span className={styles.specValue}>Northern Lights · 48 tracks</span>
                  <Button variant="primary" size="s">
                    Resume
                  </Button>
                </div>
              </div>
            </Enter>
            {["Midnight Ferry", "Glass Harbour", "Paper Moons"].map((title, index) => (
              <Enter key={title} index={3 + index} screen={screen}>
                <Row variant="track" leading={index + 1} title={title} subtitle="Northern Lights" meta={["3:42", "4:05", "2:58"][index]} />
              </Enter>
            ))}
          </div>
        </Group>
      </div>
    </Section>
  );
}
