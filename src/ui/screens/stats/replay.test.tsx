// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StatsOverview, StatsRow } from "../../ports/stats";
import { isoDate } from "./statsModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ data: null as unknown, asked: [] as unknown[], play: vi.fn() }));

vi.mock("../../ports/stats", () => ({
  rowTrack: (track: unknown) => track,
  useStatsOverview: (days: unknown) => {
    mocks.asked.push(days);
    return { data: mocks.data, failed: false, reload: () => undefined };
  },
  useStatsPaused: () => ({ paused: false, setPaused: () => undefined }),
}));
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: () => undefined }));
vi.mock("../../ports/library", () => ({ useCreatePlaylist: () => ({}), useAddPlaylistTracks: () => ({}) }));
vi.mock("../../ports/player", () => ({ playerEngine: { playTrack: mocks.play }, usePlayerStore: () => null }));
vi.mock("../../ports/covers", () => ({ coverSrc: () => "", colorsFor: () => Promise.resolve({ color2: "rgb(1, 2, 3)" }) }));
vi.mock("../entity/EntityTracks", () => ({ useUnavailable: () => (track: { id: string }) => (track.id === "t3" ? "gone" : null) }));
vi.mock("./StatsRows", () => ({ artistHref: () => "", trackHref: () => "", useSongMenu: () => ({ open: () => undefined, layers: null }) }));
vi.mock("./ReplayShare", () => ({ ReplayShare: () => null }));

const { Replay } = await import("./Replay");

const today = isoDate(new Date());

function row(index: number): StatsRow {
  return {
    id: `t${index}`,
    title: `Song ${index}`,
    subtitle: "Band",
    plays: 9 - index,
    listenedMs: 60_000,
    rank: index + 1,
    rankDelta: null,
    isNew: false,
    track: { id: `t${index}` },
  };
}

function overview(songs: number): StatsOverview {
  const rows = Array.from({ length: songs }, (_, index) => row(index));
  return {
    range: { from: today, to: today, days: 1, previousFrom: null, previousTo: null },
    totals: {
      listenedMs: songs * 60_000,
      plays: songs,
      tracks: songs,
      artists: 1,
      albums: 1,
      activeDays: songs > 0 ? 1 : 0,
      sessions: 1,
      skipRate: 0,
      completedRate: 1,
    },
    previous: null,
    newTracks: 0,
    newArtists: 0,
    currentStreak: 1,
    longestStreak: { days: 1, from: today, to: today },
    firstPlayedAt: songs > 0 ? new Date().toISOString() : null,
    days: [{ day: today, listenedMs: songs * 60_000, plays: songs }],
    calendar: [],
    byHour: Array.from({ length: 24 }, () => 0),
    byWeekday: Array.from({ length: 7 }, () => 0),
    sources: [],
    origins: [],
    sessions: { count: 1, averageMs: 0, longestMs: 0, longestStartedAt: null, longestTracks: 0 },
    top: { tracks: rows, artists: [], albums: [], playlists: [], genres: [] },
    mostSkipped: [],
    mostReplayed: [],
    onRepeat: [],
    discoveries: [],
    forgotten: [],
    firstSong: null,
    lastSong: null,
    artistDays: [],
  };
}

let root: Root;
let host: HTMLDivElement;

const open = (path: string) =>
  act(() =>
    root.render(
      <MemoryRouter key={path} initialEntries={[path]}>
        <Replay />
      </MemoryRouter>,
    ),
  );
const shown = () => [...document.querySelectorAll<HTMLElement>("[data-replay-screen]")].map((node) => node.dataset.replayScreen);

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.asked = [];
  mocks.play.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("a first hour shows only the screens it has music for", () => {
  mocks.data = overview(2);
  open("/stats");
  expect(shown()).toEqual(["time", "song", "close"]);
});

it("more songs add the list, and the top song plays with the rest that can play behind it", () => {
  mocks.data = overview(6);
  open("/stats");
  expect(shown()).toContain("songs");
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === "ui.stats.play")!;
  act(() => button.click());
  expect(mocks.play.mock.calls[0][0]).toEqual({ id: "t0" });
  expect(mocks.play.mock.calls[0][1]).toHaveLength(5);
});

it("a period still running is asked for up to today, a finished one whole", () => {
  mocks.data = overview(0);
  open("/stats?kind=year");
  expect(mocks.asked[0]).toEqual({ from: `${today.slice(0, 4)}-01-01`, to: today });
  mocks.asked = [];
  open("/stats?kind=month&at=2020-02-10");
  expect(mocks.asked[0]).toEqual({ from: "2020-02-01", to: "2020-02-29" });
  expect(host.querySelector("[data-testid=stats-empty]")).not.toBeNull();
});
