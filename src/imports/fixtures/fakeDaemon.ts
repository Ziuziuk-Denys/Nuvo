import { MAX_ROWS } from "../types";
import { CoreError, type ImportsDaemon, type StartBody } from "../core";
import type { PendingJob } from "../pending";
import type { CatalogTrack, Decision, ImportNext, ImportRow, ImportSummary, Listing, ReportRow, RowsFilter, RowsPage } from "../types";

export function summary(id: string, patch: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id,
    sourceKind: "deezer",
    label: "Northbound",
    targetKind: "playlist",
    targetId: `pl-${id}`,
    createdAt: "2026-10-31T10:00:00Z",
    status: "running",
    total: 3,
    done: 0,
    needsReview: 0,
    counts: { exact: 0, likely: 0, check: 0, missing: 0, already: 0 },
    ...patch,
  };
}

export function reportRow(id: number, patch: Partial<ReportRow> = {}): ReportRow {
  return {
    id,
    position: id,
    source: { title: `Song ${id}`, artists: ["Mira Holt"] },
    candidates: [],
    ...patch,
  };
}

const ROW_SOURCES = ["youtube-music", "soundcloud", "apple-music", "deezer", "spotify", "nuvo-link", "legacy"];

function validateStart(body: StartBody): void {
  const invalid = () => new CoreError(400, "INVALID_INPUT");
  if (body.target?.kind === "playlist" && !body.target.id) throw invalid();
  if ("file" in body) return;
  if (!ROW_SOURCES.includes(body.source)) throw invalid();
  if (body.rows.length > MAX_ROWS) throw invalid();
  if (!body.label.trim()) throw invalid();
}

export class FakeDaemon implements ImportsDaemon {
  started: StartBody[] = [];
  startAnswer: ImportSummary[] | CoreError = [summary("i1")];
  script = new Map<string, (ImportNext | CoreError)[]>();
  posted: {
    id: string;
    rowId: number;
    step: number;
    candidates: CatalogTrack[];
    failed?: boolean;
  }[] = [];
  postError: CoreError | null = null;
  decisions: {
    id: string;
    rowId: number;
    decision: Decision;
    track?: CatalogTrack;
  }[] = [];
  bulks: { id: string; action: string }[] = [];
  removed: string[] = [];
  pages = new Map<string, RowsPage>();
  rowsCalls: { id: string; filter: RowsFilter; cursor?: string }[] = [];
  summaries = new Map<string, ImportSummary>();
  soundcloud = new Map<string, Listing | CoreError>();
  spotify = new Map<string, Listing | CoreError>();
  addedToPlaylist: { playlistId: string; track: CatalogTrack }[] = [];
  nextCalls = 0;
  private leased = new Map<string, number>();

  async start(body: StartBody): Promise<ImportSummary[]> {
    this.started.push(body);
    validateStart(body);
    if (this.startAnswer instanceof CoreError) throw this.startAnswer;
    return this.startAnswer;
  }
  appended: { id: string; rows: ImportRow[] }[] = [];
  failAppendFrom: number | null = null;
  async appendRows(id: string, rows: ImportRow[]): Promise<ImportSummary> {
    if (this.failAppendFrom !== null && this.appended.length >= this.failAppendFrom) throw new CoreError(0, "CORE_DOWN");
    this.appended.push({ id, rows });
    return summary(id);
  }
  async list(): Promise<ImportSummary[]> {
    return [...this.summaries.values()];
  }
  async summary(id: string): Promise<ImportSummary> {
    const found = this.summaries.get(id);
    if (!found) throw new CoreError(404, "NOT_FOUND");
    return found;
  }
  async remove(id: string): Promise<void> {
    this.removed.push(id);
  }
  async next(id: string): Promise<ImportNext> {
    this.nextCalls += 1;
    const answer = this.script.get(id)?.shift() ?? { done: true };
    if (answer instanceof CoreError) throw answer;
    if ("rowId" in answer) this.leased.set(`${id}:${answer.rowId}`, answer.search.step);
    return answer;
  }
  async postCandidates(id: string, rowId: number, body: { step: number; candidates: CatalogTrack[]; failed?: boolean }): Promise<ReportRow> {
    if (body.candidates.length > 100) throw new CoreError(400, "INVALID_INPUT");
    if (body.candidates.some((c) => !c.id)) throw new CoreError(400, "INVALID_INPUT");
    const key = `${id}:${rowId}`;
    const step = this.leased.get(key);
    if (step === undefined) throw new CoreError(404, "NOT_FOUND");
    if (step !== body.step) throw new CoreError(409, "CONFLICT");
    this.posted.push({ id, rowId, ...body });
    if (this.postError) throw this.postError;
    this.leased.set(key, step + 1);
    return reportRow(rowId);
  }
  async rows(id: string, filter: RowsFilter, cursor?: string): Promise<RowsPage> {
    this.rowsCalls.push({ id, filter, cursor });
    return this.pages.get(`${id}:${filter}:${cursor ?? ""}`) ?? { items: [] };
  }
  async decide(id: string, rowId: number, decision: Decision, track?: CatalogTrack): Promise<ReportRow> {
    if (!["use", "pick", "remove", "keep"].includes(decision)) throw new CoreError(400, "INVALID_INPUT");
    if (decision === "pick" && !track?.id) throw new CoreError(400, "INVALID_INPUT");
    this.decisions.push({ id, rowId, decision, track });
    return reportRow(rowId, { decision, track });
  }
  async bulk(id: string, action: "accept-check" | "retry-failed"): Promise<ImportSummary> {
    if (action !== "accept-check" && action !== "retry-failed") throw new CoreError(400, "INVALID_INPUT");
    this.bulks.push({ id, action });
    return summary(id);
  }
  async reportCsv(): Promise<string> {
    return "position,title\n1,Paper Moons\n";
  }
  async addToPlaylist(playlistId: string, track: CatalogTrack): Promise<void> {
    this.addedToPlaylist.push({ playlistId, track });
  }
  pending: PendingJob | null = null;
  async pendingTrack(): Promise<PendingJob | null> {
    return this.pending;
  }
  async savePendingTrack(job: PendingJob): Promise<void> {
    this.pending = job;
  }
  async clearPendingTrack(): Promise<void> {
    this.pending = null;
  }
  async soundcloudSearch(): Promise<CatalogTrack[]> {
    return [];
  }
  async soundcloudListing(url: string): Promise<Listing> {
    const answer = this.soundcloud.get(url) ?? new CoreError(404, "NOT_FOUND");
    if (answer instanceof CoreError) throw answer;
    return answer;
  }
  async spotifyListing(url: string): Promise<Listing> {
    const answer = this.spotify.get(url) ?? new CoreError(404, "NOT_FOUND");
    if (answer instanceof CoreError) throw answer;
    return answer;
  }
}
