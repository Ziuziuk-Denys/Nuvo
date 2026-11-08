/**
 * Shared links that arrive by deep link (`link:open`, or `link:take-pending` on a cold start) wait here
 * until the shell listens, then open the search screen with the link. Newest wins, as in main.
 */
type Listener = (link: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

export function deliverShareLink(id: string): void {
  const link = `nuvo://share?id=${id}`;
  if (listeners.size === 0) pending = link;
  for (const listener of listeners) listener(link);
}

/** Registers a listener (every listener hears every link) and hands a link that arrived earlier to the first. */
export function onShareLink(next: Listener): () => void {
  listeners.add(next);
  if (pending) {
    const link = pending;
    pending = null;
    next(link);
  }
  return () => {
    listeners.delete(next);
  };
}
