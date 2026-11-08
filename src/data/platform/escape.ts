/** Escape guards: a recorder or dialog that owns Escape holds one so global Escape handlers stand down. */
let held = 0;

export function acquireEscapeGuard(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}

export function isEscapeGuarded(): boolean {
  return held > 0;
}
