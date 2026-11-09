export function exclusive<T>(busy: T): (task: () => Promise<T>) => Promise<T> {
  let open = false;
  return async (task) => {
    if (open) return busy;
    open = true;
    try {
      return await task();
    } finally {
      open = false;
    }
  };
}
