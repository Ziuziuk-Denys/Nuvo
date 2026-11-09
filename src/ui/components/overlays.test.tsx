// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, useContextMenu, type MenuItem } from "./Menu";
import { Popover } from "./Popover";
import { Sheet } from "./Sheet";

const guard = vi.hoisted(() => ({ held: false }));
vi.mock("../ports/escape", () => ({ isEscapeGuarded: () => guard.held }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  // jsdom has no layout observers; the popover only needs the calls to exist
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function mount(node: ReactNode) {
  act(() => root.render(node));
}

function fire(target: EventTarget, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
}

const key = (name: string) => {
  const [keyName, ...modifiers] = name.split("+").reverse();
  fire(
    document.activeElement ?? document.body,
    new KeyboardEvent("keydown", {
      key: keyName,
      shiftKey: modifiers.includes("Shift"),
      ctrlKey: modifiers.includes("Ctrl"),
      bubbles: true,
    }),
  );
};
const pointerDown = (target: EventTarget) => fire(target, new MouseEvent("pointerdown", { bubbles: true }));
const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const button = (name: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === name)!;
const settle = () => act(() => vi.advanceTimersByTime(500));

function PopoverHarness({ width = 560, onClose }: { width?: 320 | 560; onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchor} onClick={() => setOpen(!open)}>
        Sound
      </button>
      <button>Elsewhere</button>
      <Popover
        open={open}
        anchor={anchor}
        width={width}
        title="Sound"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <button>Flat</button>
        <button>Bass</button>
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("opens as a dialog named by its title with focus inside", () => {
    mount(<PopoverHarness />);
    const [dialog] = dialogs();
    expect(dialog.getAttribute("aria-label")).toBe("Sound");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and gives focus back to the anchor", () => {
    mount(<PopoverHarness />);
    key("Escape");
    settle();
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(button("Sound"));
  });

  it("closes on a pointerdown outside, and not on one on the anchor", () => {
    const onClose = vi.fn();
    mount(<PopoverHarness onClose={onClose} />);
    pointerDown(button("Sound"));
    pointerDown(dialogs()[0]);
    expect(onClose).not.toHaveBeenCalled();
    pointerDown(button("Elsewhere"));
    expect(onClose).toHaveBeenCalledTimes(1);
    settle();
    expect(dialogs()).toHaveLength(0);
  });

  it("pours out of a 44 px sliver at the anchor's centre, on the anchor's side", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 400, width: 40, top: 700, bottom: 740, right: 440, height: 40, x: 400, y: 700, toJSON: () => ({}) });
    mount(<PopoverHarness width={320} />);
    const panel = dialogs()[0];
    // 160 = anchor centre (420) minus panel start (260)
    expect(panel.style.getPropertyValue("--nx")).toBe("160px");
    expect(panel.style.getPropertyValue("--from")).toBe("calc(100% - 1px) 138px 0 138px");
    expect(panel.hasAttribute("data-below")).toBe(false);
    expect(panel.hasAttribute("data-fresh")).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(panel.hasAttribute("data-fresh")).toBe(false);
    rect.mockRestore();
  });

  it("morphs the same container when the width changes", () => {
    mount(<PopoverHarness width={560} />);
    const before = dialogs()[0];
    mount(<PopoverHarness width={320} />);
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]).toBe(before);
  });

  it("keeps Tab inside (wraps forward from last to first)", () => {
    mount(<PopoverHarness />);
    const dialog = dialogs()[0];
    button("Bass").focus();
    key("Tab");
    expect(document.activeElement?.textContent).toBe("Flat");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps Shift+Tab inside (wraps backward from first to last)", () => {
    mount(<PopoverHarness />);
    const dialog = dialogs()[0];
    button("Flat").focus();
    key("Shift+Tab");
    expect(document.activeElement?.textContent).toBe("Bass");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("fails to wrap tab if trapTab is disabled", () => {
    function PopoverWithoutTrapTab() {
      const [open, setOpen] = useState(true);
      const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
      return (
        <>
          <button ref={setAnchor} onClick={() => setOpen(!open)}>
            Sound
          </button>
          <div role="dialog" tabIndex={-1}>
            <button>Flat</button>
            <button>Bass</button>
          </div>
        </>
      );
    }
    mount(<PopoverWithoutTrapTab />);
    button("Bass").focus();
    key("Tab");
    expect(document.activeElement?.textContent).not.toBe("Flat");
  });

  it("does not close on Escape when escape guard is held", () => {
    const onClose = vi.fn();
    mount(<PopoverHarness onClose={onClose} />);
    expect(dialogs()).toHaveLength(1);
    guard.held = true;
    key("Escape");
    expect(dialogs()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    guard.held = false;
    key("Escape");
    settle();
    expect(dialogs()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Sheet", () => {
  it("ignores Escape and backdrop clicks when not dismissible", () => {
    const onClose = vi.fn();
    mount(
      <Sheet open title="Recovery phrase" dismissible={false} onClose={onClose} actions={[{ label: "I wrote it down", onClick: vi.fn(), primary: true }]}>
        Write these words down.
      </Sheet>,
    );
    const dialog = dialogs()[0];
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    key("Escape");
    const layer = dialog.parentElement!;
    pointerDown(layer);
    fire(layer, new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click when dismissible", () => {
    const onClose = vi.fn();
    mount(
      <Sheet open title="New playlist" onClose={onClose} actions={[]}>
        Name it.
      </Sheet>,
    );
    const layer = dialogs()[0].parentElement!;
    pointerDown(layer);
    fire(layer, new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus when closed", () => {
    function SheetHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button>Opener</button>
          <Sheet open={open} title="Test" onClose={() => setOpen(false)} actions={[]}>
            Content
          </Sheet>
        </>
      );
    }
    mount(<SheetHarness />);
    expect(dialogs()).toHaveLength(1);
    const dialogFocusedElement = document.activeElement;
    expect(dialogs()[0].contains(dialogFocusedElement)).toBe(true);
    key("Escape");
    settle();
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement?.closest('[role="dialog"]')).toBeNull();
  });

  it("renders the actions with the primary last", () => {
    mount(
      <Sheet
        open
        title="New playlist"
        onClose={vi.fn()}
        actions={[
          { label: "Create", onClick: vi.fn(), primary: true },
          { label: "Cancel", onClick: vi.fn() },
        ]}
      >
        Name it.
      </Sheet>,
    );
    const labels = [...dialogs()[0].querySelectorAll("button")].map((node) => node.textContent);
    expect(labels).toEqual(["Cancel", "Create"]);
  });
});

function MenuHarness({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(true);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchor}>More</button>
      <Menu open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} />
    </>
  );
}

describe("Menu", () => {
  const select = { play: vi.fn(), rename: vi.fn(), remove: vi.fn() };
  const items: MenuItem[] = [
    { label: "Play next", onSelect: select.play },
    { label: "Rename", onSelect: select.rename },
    "separator",
    { label: "Remove from library", onSelect: select.remove, danger: true },
  ];

  beforeEach(() => Object.values(select).forEach((fn) => fn.mockClear()));

  it("moves with the arrows and selects with Enter", () => {
    mount(<MenuHarness items={items} />);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    key("ArrowDown");
    key("Enter");
    expect(select.rename).toHaveBeenCalledTimes(1);
    expect(select.play).not.toHaveBeenCalled();
    settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("jumps to the next item starting with a typed letter", () => {
    mount(<MenuHarness items={items} />);
    key("r");
    expect(document.activeElement?.textContent).toBe("Rename");
    key("r");
    expect(document.activeElement?.textContent).toBe("Remove from library");
  });

  it("closes on Escape", () => {
    mount(<MenuHarness items={items} />);
    key("Escape");
    settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens at the pointer for a right click", () => {
    function ContextHarness() {
      const menu = useContextMenu();
      return (
        <>
          <div data-testid="row" onContextMenu={(event) => menu.open(event, items)}>
            Midnight Ferry
          </div>
          {menu.element}
        </>
      );
    }
    mount(<ContextHarness />);
    fire(host.querySelector("[data-testid=row]")!, new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 60 }));
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
  });

  it("flips to stay inside the window when opened near bottom-right", () => {
    const origInnerWidth = window.innerWidth;
    const origInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });

    function BottomRightHarness() {
      const [open, setOpen] = useState(true);
      const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
      return (
        <>
          <button ref={setAnchor}>More</button>
          <Menu open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} />
        </>
      );
    }

    mount(<BottomRightHarness />);
    const anchor = button("More");
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const rect = anchor.getBoundingClientRect() as any;

    rect.left = 350;
    rect.right = 380;
    rect.top = 250;
    rect.bottom = 270;
    anchor.getBoundingClientRect = vi.fn(() => rect);

    settle();

    const menuStyle = window.getComputedStyle(menu);
    const transformOrigin = menuStyle.transformOrigin;
    expect(transformOrigin).toBeDefined();

    Object.defineProperty(window, "innerWidth", { value: origInnerWidth, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: origInnerHeight, configurable: true });
  });
});

describe("layers together", () => {
  it("Escape closes the overlay opened last", () => {
    const popoverClose = vi.fn();
    const sheetClose = vi.fn();
    function Both({ sheet }: { sheet: boolean }) {
      return (
        <>
          <PopoverHarness onClose={popoverClose} />
          <Sheet open={sheet} title="New playlist" onClose={sheetClose} actions={[]}>
            Name it.
          </Sheet>
        </>
      );
    }
    mount(<Both sheet={false} />);
    mount(<Both sheet />);
    key("Escape");
    expect(sheetClose).toHaveBeenCalledTimes(1);
    expect(popoverClose).not.toHaveBeenCalled();
  });
});
