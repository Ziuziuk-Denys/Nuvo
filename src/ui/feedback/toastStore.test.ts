import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_DURATION_MS, defaultDuration, STICKY, useToastStore, visibleToast } from "./toastStore";

const store = () => useToastStore.getState();

afterEach(() => {
  useToastStore.setState({ queue: [] });
});

describe("toast store", () => {
  it("queues toasts and shows them one at a time, oldest first", () => {
    store().show({ message: "One" });
    store().show({ message: "Two" });
    expect(store().queue.map((toast) => toast.message)).toEqual(["One", "Two"]);
    expect(visibleToast(store().queue)?.message).toBe("One");
    store().dismiss(visibleToast(store().queue)!.id);
    expect(visibleToast(store().queue)?.message).toBe("Two");
  });

  it("hides after 4 s unless a duration is given; loaders stay", () => {
    store().show({ message: "Liked" });
    store().show({ message: "Importing", variant: "loader" });
    store().show({ message: "Long", duration: 7000 });
    expect(store().queue.map((toast) => toast.duration)).toEqual([DEFAULT_DURATION_MS, STICKY, 7000]);
    expect(DEFAULT_DURATION_MS).toBe(4000);
  });

  it("gives long words time to be read and a toast with an action time to be used", () => {
    const undo = { label: "Undo", onClick: () => undefined };
    expect(defaultDuration({ message: "x".repeat(120) }, "info")).toBe(7200);
    expect(defaultDuration({ message: "x".repeat(400) }, "info")).toBe(10_000);
    expect(defaultDuration({ message: "Hidden", action: undo }, "info")).toBe(8000);
    expect(defaultDuration({ message: "Saving" }, "loader")).toBe(STICKY);
  });

  it("drops a message that is already waiting", () => {
    store().show({ message: "Added to queue" });
    store().show({ message: "Added to queue" });
    expect(store().queue).toHaveLength(1);
  });

  it("updates a toast with the same id in place", () => {
    store().show({ id: "import", message: "Importing", variant: "loader" });
    store().show({ message: "Other" });
    store().show({ id: "import", message: "Imported", variant: "success", duration: 5000 });
    expect(store().queue.map((toast) => toast.message)).toEqual(["Imported", "Other"]);
  });

  it("puts a timed toast in front of a sticky one", () => {
    store().show({ id: "status", message: "Retrying", duration: STICKY });
    store().show({ message: "Liked" });
    expect(visibleToast(store().queue)?.message).toBe("Liked");
    store().dismiss(visibleToast(store().queue)!.id);
    expect(visibleToast(store().queue)?.message).toBe("Retrying");
  });

  it("calls onDismiss when a toast leaves", () => {
    const onDismiss = vi.fn();
    store().show({ id: 1, message: "Bye", onDismiss });
    store().dismiss(1);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(store().queue).toEqual([]);
  });

  it("removes a toast quietly when its owner takes it back", () => {
    const onDismiss = vi.fn();
    store().show({ id: 2, message: "Importing", onDismiss });
    store().remove(2);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(store().queue).toEqual([]);
  });

  it("takes the legacy nuvo:toast events", () => {
    const stop = store().listen();
    window.dispatchEvent(new CustomEvent("nuvo:toast", { detail: { message: "Saved", variant: "success", options: { id: "x" } } }));
    expect(store().queue[0]).toMatchObject({ id: "x", message: "Saved", variant: "success" });
    window.dispatchEvent(new CustomEvent("nuvo:toast-dismiss", { detail: { id: "x" } }));
    expect(store().queue).toEqual([]);
    stop();
  });
});
