use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use nuvo_fetch::TikTokPost;
use nuvo_fetch::ytdlp::{MediaTags, Resolved};

pub const TTL: Duration = Duration::from_secs(60);
const MAX_ENTRIES: usize = 32;
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inspected {
    TikTok(TikTokPost),
    Media(Resolved, MediaTags),
}

#[derive(Default)]
pub struct LinkCache {
    entries: Mutex<HashMap<String, (Instant, Inspected)>>,
}

fn size_of(value: &Inspected) -> usize {
    format!("{value:?}").len()
}

impl LinkCache {
    pub fn put(&self, keys: &[&str], value: Inspected, now: Instant) {
        let mut entries = self.entries.lock().expect("link cache lock");
        entries.retain(|_, (at, _)| now.saturating_duration_since(*at) < TTL);
        for key in keys {
            entries.insert((*key).to_string(), (now, value.clone()));
        }
        let mut bytes: usize = entries.values().map(|(_, value)| size_of(value)).sum();
        while entries.len() > MAX_ENTRIES || bytes > MAX_BYTES {
            let Some(oldest) = entries.iter().min_by_key(|(_, (at, _))| *at).map(|(key, _)| key.clone()) else { break };
            if let Some((_, value)) = entries.remove(&oldest) {
                bytes -= size_of(&value);
            }
        }
    }

    pub fn get(&self, key: &str, now: Instant) -> Option<Inspected> {
        let entries = self.entries.lock().expect("link cache lock");
        entries.get(key).filter(|(at, _)| now.saturating_duration_since(*at) < TTL).map(|(_, value)| value.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nuvo_fetch::Remote;

    fn media(title: &str) -> Inspected {
        let remote = Remote { url: "https://media.example/a".into(), headers: vec![] };
        Inspected::Media(Resolved { title: Some(title.into()), duration_ms: None, remote }, MediaTags::default())
    }

    #[test]
    fn entries_live_for_sixty_seconds_under_every_key() {
        let cache = LinkCache::default();
        let start = Instant::now();
        cache.put(&["https://a.example/x?si=1", "https://a.example/x"], media("x"), start);
        assert_eq!(cache.get("https://a.example/x", start + Duration::from_secs(59)), Some(media("x")));
        assert_eq!(cache.get("https://a.example/x?si=1", start + Duration::from_secs(59)), Some(media("x")));
        assert_eq!(cache.get("https://a.example/x", start + TTL), None);
        assert_eq!(cache.get("https://b.example/", start), None);
    }

    #[test]
    fn a_burst_keeps_only_the_newest_entries() {
        let cache = LinkCache::default();
        let start = Instant::now();
        for i in 0..40u64 {
            cache.put(&[&format!("https://a.example/{i}")], media("x"), start + Duration::from_millis(i));
        }
        let now = start + Duration::from_millis(40);
        assert_eq!(cache.get("https://a.example/0", now), None);
        assert!(cache.get("https://a.example/39", now).is_some());
        assert_eq!(cache.entries.lock().unwrap().len(), MAX_ENTRIES);
    }

    #[test]
    fn big_values_are_evicted_to_keep_the_total_under_the_cap() {
        let cache = LinkCache::default();
        let start = Instant::now();
        let big = "x".repeat(MAX_BYTES / 3);
        for i in 0..6u64 {
            cache.put(&[&format!("https://a.example/{i}")], media(&big), start + Duration::from_millis(i));
        }
        let entries = cache.entries.lock().unwrap();
        let total: usize = entries.values().map(|(_, value)| size_of(value)).sum();
        assert!(total <= MAX_BYTES && !entries.is_empty());
        assert!(entries.contains_key("https://a.example/5"));
        assert!(!entries.contains_key("https://a.example/0"));
    }
}
