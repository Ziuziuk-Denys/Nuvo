// Only CSP-allowed hosts: a renderer probe of SoundCloud would be a CSP violation
const PROBES = ["https://music.youtube.com/generate_204"];

export async function probeStreamingHosts(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const results = await Promise.all(
    PROBES.map((url) =>
      fetchImpl(url, { mode: "no-cors", cache: "no-store" }).then(
        () => true,
        () => false,
      ),
    ),
  );
  return results.some(Boolean);
}
