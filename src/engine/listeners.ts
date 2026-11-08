/** A set of callbacks: subscribe returns the way out, emit calls a snapshot so a callback may unsubscribe itself. */
export function createListeners<Args extends unknown[] = []>() {
  const callbacks = new Set<(...args: Args) => void>();
  return {
    subscribe(callback: (...args: Args) => void): () => void {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    emit(...args: Args): void {
      for (const callback of [...callbacks]) callback(...args);
    },
  };
}
