type Listener = (link: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

export function deliverShareLink(id: string): void {
  const link = `nuvo://share?id=${id}`;
  if (listeners.size === 0) pending = link;
  for (const listener of listeners) listener(link);
}

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
