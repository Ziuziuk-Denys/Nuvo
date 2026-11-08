//! Last.fm glue: stored settings, the scrobble queue flush and now playing.

use std::time::Duration;

use nuvo_contracts::LastfmStatus;
use nuvo_lastfm::{Credentials, INVALID_PARAMETERS, INVALID_SESSION, LastfmError, MAX_BATCH, Scrobble, TrackInfo};
use nuvo_store::{Connection, StoreError, now_ms, scrobbles, settings, tracks};
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::state::{AppState, Unlocked};

/// Offline plays and retries whose backoff ran out are picked up this often.
const FLUSH_EVERY: Duration = Duration::from_secs(60);

pub fn text(conn: &Connection, key: &str) -> Result<Option<String>, StoreError> {
    Ok(settings::get(conn, key)?.and_then(|v| v.as_str().map(str::to_string)))
}

pub fn credentials(conn: &Connection) -> Result<Option<Credentials>, StoreError> {
    Ok(match (text(conn, settings::LASTFM_API_KEY)?, text(conn, settings::LASTFM_API_SECRET)?) {
        (Some(api_key), Some(api_secret)) => Some(Credentials { api_key, api_secret }),
        _ => None,
    })
}

pub fn status(conn: &Connection) -> Result<LastfmStatus, StoreError> {
    Ok(LastfmStatus {
        has_credentials: credentials(conn)?.is_some(),
        connected: text(conn, settings::LASTFM_SESSION_KEY)?.is_some(),
        user: text(conn, settings::LASTFM_USER)?,
        enabled: settings::get(conn, settings::LASTFM_ENABLED)?.and_then(|v| v.as_bool()).unwrap_or(true),
        queued: scrobbles::count(conn)?,
        last_error: text(conn, settings::LASTFM_LAST_ERROR)?,
    })
}

/// Forgets the session (the user disconnected, changed the key, or revoked access on last.fm).
pub fn clear_session(conn: &Connection) -> Result<(), StoreError> {
    settings::set(conn, settings::LASTFM_SESSION_KEY, &Value::Null)?;
    settings::set(conn, settings::LASTFM_USER, &Value::Null)
}

/// Credentials and session key while scrobbling is active.
fn account(conn: &Connection) -> Result<Option<(Credentials, String)>, StoreError> {
    if !scrobbles::active(conn)? {
        return Ok(None);
    }
    Ok(credentials(conn)?.zip(text(conn, settings::LASTFM_SESSION_KEY)?))
}

/// Keeps the failure for the settings card. Error 9 (access revoked) and refused credentials
/// drop the session so the card asks to reconnect, and queued plays wait for the new session.
/// The session is cleared only if it is still the one that failed: a reconnect may have replaced it.
pub async fn note_failure(data: &Unlocked, session_key: &str, err: &LastfmError) -> Result<(), ApiError> {
    let message = err.to_string();
    let drop_session = err.is_permanent_auth() || matches!(err, LastfmError::Api { code: INVALID_SESSION, .. });
    let failed_key = session_key.to_string();
    data.db
        .call(move |c| {
            let tx = c.unchecked_transaction()?;
            if drop_session && text(&tx, settings::LASTFM_SESSION_KEY)?.as_deref() == Some(failed_key.as_str()) {
                clear_session(&tx)?;
            }
            settings::set(&tx, settings::LASTFM_LAST_ERROR, &json!(message))?;
            tx.commit()?;
            Ok(())
        })
        .await?;
    Ok(())
}

/// Sends due plays in batches of `MAX_BATCH` until the queue is empty or a batch fails, and
/// returns how many were accepted. A failed batch is retried later with backoff.
pub async fn flush(state: &AppState, now: i64) -> Result<usize, ApiError> {
    let _in_flight = state.scrobble_lock.lock().await;
    let data = state.data()?;
    let mut sent = 0;
    loop {
        let (account, batch) = data
            .db
            .call(move |c| {
                // Last.fm refuses plays older than 14 days, so they are not worth keeping.
                scrobbles::drop_old(c, now)?;
                Ok((account(c)?, scrobbles::due(c, now, MAX_BATCH)?))
            })
            .await?;
        let Some((creds, session_key)) = account else {
            return Ok(sent);
        };
        if batch.is_empty() {
            return Ok(sent);
        }
        let ids: Vec<i64> = batch.iter().map(|q| q.id).collect();
        let plays: Vec<Scrobble> = batch
            .into_iter()
            .map(|q| Scrobble {
                track: TrackInfo { artist: q.artist, track: q.track, album: q.album, duration_s: q.duration_s },
                timestamp: q.played_at,
            })
            .collect();
        // Delivery is at-least-once: a crash between Last.fm accepting a batch and the delete resends it.
        match state.lastfm.scrobble(&creds, &session_key, &plays).await {
            Ok((_, ignored)) => {
                // Ignored plays (bad metadata, too old) will never be taken later, so they leave the queue too.
                sent += ids.len().saturating_sub(usize::try_from(ignored).unwrap_or(0));
                data.db
                    .call(move |c| {
                        scrobbles::remove(c, &ids)?;
                        settings::set(c, settings::LASTFM_LAST_ERROR, &Value::Null)
                    })
                    .await?;
            }
            // Last.fm rejected the content of the batch; sending it again cannot succeed.
            Err(err @ LastfmError::Api { code: INVALID_PARAMETERS, .. }) => {
                tracing::warn!(%err, dropped = ids.len(), "last.fm rejected a scrobble batch");
                note_failure(&data, &session_key, &err).await?;
                data.db.call(move |c| scrobbles::remove(c, &ids)).await?;
            }
            // Revoked session or refused credentials: note_failure cleared the session, so there are no
            // retries and the queue waits for the next connect.
            Err(err) if err.is_permanent_auth() || matches!(err, LastfmError::Api { code: INVALID_SESSION, .. }) => {
                tracing::warn!(%err, "last.fm refused the session or credentials");
                note_failure(&data, &session_key, &err).await?;
                return Ok(sent);
            }
            Err(err) => {
                tracing::warn!(%err, retryable = err.is_retryable(), "scrobble failed, will retry");
                note_failure(&data, &session_key, &err).await?;
                data.db.call(move |c| scrobbles::defer(c, &ids, now)).await?;
                return Ok(sent);
            }
        }
    }
}

/// Flushes in the background so the request that queued a play does not wait for Last.fm.
pub fn spawn_flush(state: &AppState) {
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(err) = flush(&state, now_ms()).await {
            tracing::warn!(?err, "scrobble flush failed");
        }
    });
}

pub fn spawn_timer(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(FLUSH_EVERY).await;
            if !state.is_locked()
                && let Err(err) = flush(&state, now_ms()).await
            {
                tracing::warn!(?err, "scrobble flush failed");
            }
        }
    });
}

/// Best effort: Last.fm failures are logged and kept as `lastError`, never returned.
pub async fn now_playing(state: &AppState, track_id: String, snapshot: Option<Value>) -> Result<(), ApiError> {
    let data = state.data()?;
    let found = data
        .db
        .call(move |c| {
            let Some(account) = account(c)? else {
                return Ok(None);
            };
            tracks::ensure(c, &track_id, snapshot.as_ref(), now_ms())?;
            Ok(scrobbles::track_meta(c, &track_id)?.map(|meta| (account, meta)))
        })
        .await?;
    let Some(((creds, session_key), meta)) = found else {
        return Ok(());
    };
    if meta.artist.trim().is_empty() || meta.title.trim().is_empty() {
        return Ok(());
    }
    let track = TrackInfo {
        artist: meta.artist,
        track: meta.title,
        album: meta.album,
        duration_s: (meta.duration_ms > 0).then_some(meta.duration_ms / 1000),
    };
    if let Err(err) = state.lastfm.now_playing(&creds, &session_key, &track).await {
        tracing::warn!(%err, "now playing update failed");
        note_failure(&data, &session_key, &err).await?;
    }
    Ok(())
}
