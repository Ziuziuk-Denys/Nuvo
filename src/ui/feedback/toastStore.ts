import { create } from "zustand";

export type ToastVariant = "success" | "checkmark" | "error" | "info" | "loading" | "loader";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string | number;
  message: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
  onDismiss?: () => void;
}

export type ToastInput = Partial<Omit<Toast, "message">> & { message: string };

export const DEFAULT_DURATION_MS = 4000;
/** The legacy API marks a toast that stays with 999999 ms; anything that long is sticky. */
export const STICKY = 999_999;

interface LegacyOptions {
  id?: string | number;
  duration?: number;
  description?: string;
  action?: ToastAction;
  button?: ToastAction;
  icon?: unknown;
  onDismiss?: () => void;
}

interface ToastState {
  queue: Toast[];
  show: (input: ToastInput) => void;
  dismiss: (id: string | number) => void;
  remove: (id: string | number) => void;
  listen: () => () => void;
}

let nextId = 0;

function isLoader(variant: ToastVariant): boolean {
  return variant === "loader" || variant === "loading";
}

export function visibleToast(queue: Toast[]): Toast | null {
  return queue.find((toast) => toast.duration < STICKY) ?? queue[0] ?? null;
}

export const useToastStore = create<ToastState>((set, get) => ({
  queue: [],

  show(input) {
    const variant = input.variant ?? "info";
    const toast: Toast = {
      ...input,
      id: input.id ?? `toast-${++nextId}`,
      variant,
      duration: input.duration ?? (isLoader(variant) ? STICKY : DEFAULT_DURATION_MS),
    };
    set(({ queue }) => {
      const index = queue.findIndex((item) => item.id === toast.id);
      if (index >= 0) {
        const current = queue[index];
        // the same words again change nothing, so a re-render never re-queues
        const same =
          current.message === toast.message &&
          current.description === toast.description &&
          current.variant === toast.variant &&
          current.duration === toast.duration;
        return same ? { queue } : { queue: queue.map((item, at) => (at === index ? toast : item)) };
      }
      const waiting = queue.some((item) => item.message === toast.message && item.description === toast.description);
      return waiting ? { queue } : { queue: [...queue, toast] };
    });
  },

  dismiss(id) {
    const toast = get().queue.find((item) => item.id === id);
    if (!toast) return;
    get().remove(id);
    toast.onDismiss?.();
  },

  remove(id) {
    set(({ queue }) => (queue.some((item) => item.id === id) ? { queue: queue.filter((item) => item.id !== id) } : { queue }));
  },

  listen() {
    const onToast = (event: Event) => {
      const { message, variant, options = {} } = (event as CustomEvent<{ message: string; variant: ToastVariant; options?: LegacyOptions }>).detail;
      get().show({
        message,
        variant,
        id: options.id,
        duration: options.duration,
        description: options.description,
        action: options.action ?? options.button,
        onDismiss: options.onDismiss,
      });
    };
    const onDismiss = (event: Event) => get().remove((event as CustomEvent<{ id: string | number }>).detail.id);
    window.addEventListener("nuvo:toast", onToast);
    window.addEventListener("nuvo:toast-dismiss", onDismiss);
    return () => {
      window.removeEventListener("nuvo:toast", onToast);
      window.removeEventListener("nuvo:toast-dismiss", onDismiss);
    };
  },
}));
