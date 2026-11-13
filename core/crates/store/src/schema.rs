/// Append-only. Each entry runs once, in its own transaction, and bumps `PRAGMA user_version`.
pub const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  album TEXT,
  album_id TEXT,
  duration_ms INTEGER NOT NULL,
  cover_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('youtube', 'soundcloud')),
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE liked_tracks (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id),
  liked_at INTEGER NOT NULL
);
CREATE TABLE saved_items (
  kind TEXT NOT NULL CHECK (kind IN ('album', 'artist', 'playlist')),
  item_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (kind, item_id)
);
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  cover_url TEXT,
  pinned_offline INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE playlist_items (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  position REAL NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE play_events (
  id INTEGER PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  played_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  end_reason TEXT NOT NULL CHECK (end_reason IN ('complete', 'skip', 'next', 'seek', 'error', 'stop')),
  context TEXT,
  context_id TEXT,
  position_in_session INTEGER,
  hour INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  loop_count INTEGER NOT NULL DEFAULT 0,
  seek_back INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE lyrics (
  track_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  synced INTEGER NOT NULL,
  instrumental INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE cache_entries (
  track_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  codec TEXT,
  last_played_at INTEGER NOT NULL
);
CREATE TABLE settings_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE INDEX play_events_track ON play_events(track_id, started_at);
CREATE INDEX play_events_session ON play_events(session_id);
CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
"#,
    r#"
CREATE TABLE recognitions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  input_kind TEXT NOT NULL CHECK (input_kind IN ('link', 'file', 'system')),
  input_label TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX recognitions_created ON recognitions(created_at);
"#,
    r#"
ALTER TABLE playlists ADD COLUMN sort_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE playlists ADD COLUMN sort_desc INTEGER NOT NULL DEFAULT 0;
"#, r#"
CREATE TABLE playlist_covers (
  playlist_id TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
"#, r#"
CREATE TABLE track_trims (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id),
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
"#, r#"
CREATE TABLE scrobble_queue (
  id INTEGER PRIMARY KEY,
  artist TEXT NOT NULL,
  track TEXT NOT NULL,
  album TEXT,
  duration_s INTEGER,
  played_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX scrobble_queue_due ON scrobble_queue(next_attempt_at);
 "#, r#"
DELETE FROM play_events WHERE rowid NOT IN (SELECT MIN(rowid) FROM play_events GROUP BY track_id, session_id, started_at);
CREATE UNIQUE INDEX play_events_idempotent ON play_events(track_id, session_id, started_at);
"#, r#"
ALTER TABLE play_events ADD COLUMN seek_forward_ms INTEGER NOT NULL DEFAULT 0;
CREATE TABLE track_keys (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id),
  work_key TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  variant_type TEXT,
  variant_by TEXT,
  computed_at INTEGER NOT NULL
);
CREATE TABLE suppressions (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('exact', 'work', 'artist')),
  key TEXT NOT NULL,
  w0 REAL NOT NULL,
  half_life_days REAL,
  track_id TEXT REFERENCES tracks(id),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'scrub_skip')),
  created_at INTEGER NOT NULL
);
CREATE TABLE candidate_edges (
  seed_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (seed_id, track_id)
);
CREATE TABLE served (
  batch_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  context TEXT NOT NULL,
  session_id TEXT,
  features_json TEXT,
  learned INTEGER NOT NULL DEFAULT 0,
  served_at INTEGER NOT NULL,
  PRIMARY KEY (batch_id, track_id)
);
CREATE TABLE track_features (
  track_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  vector BLOB NOT NULL,
  analysed_at INTEGER NOT NULL
);
CREATE TABLE taste_excluded (
  kind TEXT NOT NULL CHECK (kind IN ('playlist', 'track')),
  id TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE TABLE rec_model (
  key TEXT PRIMARY KEY,
  weights_json TEXT NOT NULL,
  events_seen INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX track_keys_work ON track_keys(work_key);
CREATE INDEX track_keys_artist ON track_keys(artist_key);
CREATE INDEX suppressions_key ON suppressions(scope, key);
CREATE INDEX candidate_edges_track ON candidate_edges(track_id);
CREATE INDEX served_track ON served(track_id, served_at);
"#, r#"
CREATE TABLE search_history (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('query', 'track', 'artist', 'album', 'playlist')),
  dedupe_key TEXT NOT NULL UNIQUE,
  query TEXT,
  item_json TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX search_history_at ON search_history(at);
"#, r#"
CREATE TABLE library_flags (
  kind TEXT NOT NULL CHECK (kind IN ('playlist', 'album', 'artist')),
  id TEXT NOT NULL,
  pinned_position REAL,
  hidden INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
"#, r#"
CREATE INDEX playlist_items_track ON playlist_items(playlist_id, track_id);
"#, r#"
CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  label TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('playlist', 'liked')),
  target_id TEXT,
  base_position REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done'))
);
CREATE TABLE import_rows (
  id INTEGER PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_json TEXT NOT NULL,
  label TEXT CHECK (label IN ('exact', 'likely', 'check', 'missing', 'already')),
  score INTEGER,
  reason TEXT,
  chosen_track_json TEXT,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  cascade_json TEXT NOT NULL DEFAULT '{"steps":[],"pool":[]}',
  decision TEXT CHECK (decision IN ('use', 'pick', 'remove', 'keep')),
  item_ref TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX import_rows_order ON import_rows(import_id, position);
"#, r#"
CREATE TABLE IF NOT EXISTS match_memo (
  key TEXT PRIMARY KEY,
  outcome_json TEXT NOT NULL,
  approved INTEGER NOT NULL,
  track_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS match_standins (
  track_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  track_json TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
"#, r#"
CREATE TABLE IF NOT EXISTS cover_entries (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_served_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cover_entries_source ON cover_entries(source);
CREATE INDEX IF NOT EXISTS cover_entries_served ON cover_entries(last_served_at);
"#, r#"
CREATE TABLE IF NOT EXISTS track_alternatives (
  track_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  alt_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
"#, r#"
CREATE TABLE IF NOT EXISTS pool_fetches (
  seed_id TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  stored INTEGER NOT NULL,
  PRIMARY KEY (seed_id, source)
);
INSERT OR IGNORE INTO pool_fetches (seed_id, source, fetched_at, stored)
  SELECT seed_id, source, max(fetched_at), count(*) FROM candidate_edges WHERE source != 'rank' GROUP BY seed_id, source;
"#, r#"
CREATE TABLE IF NOT EXISTS rec_starters (
  track_id TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);
UPDATE candidate_edges SET source = 'yt_radio' WHERE source = 'youtube-radio';
UPDATE candidate_edges SET source = 'sc_related' WHERE source = 'soundcloud-radio';
UPDATE OR IGNORE pool_fetches SET source = 'yt_radio' WHERE source = 'youtube-radio';
UPDATE OR IGNORE pool_fetches SET source = 'sc_related' WHERE source = 'soundcloud-radio';
DELETE FROM pool_fetches WHERE source IN ('youtube-radio', 'soundcloud-radio');
"#, r#"
CREATE TABLE IF NOT EXISTS lyrics_user (
  track_id TEXT PRIMARY KEY,
  format TEXT CHECK (format IN ('lrc', 'plain')),
  content TEXT,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);
"#, r#"
CREATE TABLE tracks_v19 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  album TEXT,
  album_id TEXT,
  duration_ms INTEGER NOT NULL,
  cover_url TEXT,
  source TEXT NOT NULL CHECK (source IN ('youtube', 'soundcloud', 'local')),
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO tracks_v19 (id, title, artist, artists_json, album, album_id, duration_ms, cover_url, source, snapshot_json, updated_at)
  SELECT id, title, artist, artists_json, album, album_id, duration_ms, cover_url, source, snapshot_json, updated_at FROM tracks;
DROP TABLE tracks;
ALTER TABLE tracks_v19 RENAME TO tracks;
CREATE TABLE IF NOT EXISTS local_roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  added_at INTEGER NOT NULL,
  last_scan_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing'))
);
CREATE TABLE IF NOT EXISTS local_files (
  path TEXT PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES local_roots(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  mime TEXT NOT NULL,
  codec TEXT NOT NULL,
  bitrate_kbps INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  lossless INTEGER NOT NULL DEFAULT 0,
  unsupported TEXT,
  lrc_path TEXT,
  scanned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS local_files_track ON local_files(track_id);
CREATE INDEX IF NOT EXISTS local_files_root ON local_files(root_id);
"#, r#"
CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  dir TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('original', 'mp3')),
  label TEXT NOT NULL,
  playlist_file INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'cancelled'))
);
CREATE TABLE IF NOT EXISTS download_items (
  download_id TEXT NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  state TEXT NOT NULL CHECK (state IN ('queued', 'done', 'failed', 'cancelled')),
  file_name TEXT,
  error TEXT,
  PRIMARY KEY (download_id, position)
);
CREATE INDEX IF NOT EXISTS download_items_state ON download_items(state, track_id);
"#, r#"
ALTER TABLE play_events ADD COLUMN tz_offset_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_events ADD COLUMN source TEXT;
UPDATE play_events SET tz_offset_min = (((started_at / 3600000 - hour) % 24 + 37) % 24 - 13) * 60,
  source = (SELECT t.source FROM tracks t WHERE t.id = play_events.track_id);
CREATE INDEX play_events_started ON play_events(started_at);
"#, r#"
CREATE TABLE IF NOT EXISTS lyrics_words (
  track_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
"#];
