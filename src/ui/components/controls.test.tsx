// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { IconButton } from "./IconButton";
import { Tabs } from "./Tabs";
import { Toggle } from "./Toggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function mount(node: React.ReactNode) {
  act(() => root.render(node));
}

function fire(target: Element, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
}

const key = (target: Element, name: string) => fire(target, new KeyboardEvent("keydown", { key: name, bubbles: true }));
const click = (target: Element) => act(() => (target as HTMLElement).click());
const tooltip = () => document.body.querySelector('[role="tooltip"]');

describe("Button", () => {
  it("calls onClick, and not when disabled", () => {
    const onClick = vi.fn();
    mount(<Button onClick={onClick}>Play</Button>);
    const button = host.querySelector("button")!;
    expect(button.type).toBe("button");
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    mount(
      <Button onClick={onClick} disabled>
        Play
      </Button>,
    );
    click(host.querySelector("button")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IconButton and Tooltip", () => {
  it("names the button and shows the label after 500 ms of hover", () => {
    vi.useFakeTimers();
    mount(<IconButton icon="queue" label="Queue" />);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Queue");
    fire(button, new MouseEvent("mouseover", { bubbles: true }));
    act(() => vi.advanceTimersByTime(499));
    expect(tooltip()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(tooltip()?.textContent).toBe("Queue");
    expect(button.getAttribute("aria-describedby")).toBe(tooltip()!.id);
    fire(button, new MouseEvent("mouseout", { bubbles: true }));
    expect(tooltip()).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("shows at once on focus and hides on Escape", () => {
    mount(<IconButton icon="like" label="Like" active />);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    act(() => button.focus());
    expect(tooltip()?.textContent).toBe("Like");
    key(document.body, "Escape");
    expect(tooltip()).toBeNull();
  });

  it("hides on press", () => {
    mount(<IconButton icon="like" label="Like" />);
    const button = host.querySelector("button")!;
    act(() => button.focus());
    expect(tooltip()).not.toBeNull();
    fire(button, new MouseEvent("mousedown", { bubbles: true }));
    expect(tooltip()).toBeNull();
  });
});

describe("Chip", () => {
  it("reflects active through aria-pressed", () => {
    mount(<Chip active={false}>1x</Chip>);
    expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
    mount(<Chip active>1x</Chip>);
    expect(host.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
  });
});

function ToggleHost({ disabled }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(false);
  return <Toggle checked={checked} onChange={setChecked} label="Remember for this track" disabled={disabled} />;
}

describe("Toggle", () => {
  it("flips aria-checked on click, Space and Enter, and is labelled by its label", () => {
    mount(<ToggleHost />);
    const toggle = host.querySelector('[role="switch"]')!;
    const label = host.querySelector("label")!;
    expect(label.htmlFor).toBe(toggle.id);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    key(toggle, " ");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    key(toggle, "Enter");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    click(label);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("ignores input when disabled", () => {
    mount(<ToggleHost disabled />);
    const toggle = host.querySelector('[role="switch"]')!;
    click(toggle);
    key(toggle, " ");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

const ITEMS = [
  { id: "eq", label: "Equalizer" },
  { id: "speed", label: "Speed" },
  { id: "sleep", label: "Sleep" },
] as const;
type TabId = (typeof ITEMS)[number]["id"];

function TabsHost({ onChange }: { onChange: (id: TabId) => void }) {
  const [value, setValue] = useState<TabId>("eq");
  return (
    <Tabs
      items={[...ITEMS]}
      value={value}
      label="Sound"
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

describe("Tabs", () => {
  it("moves and selects with the arrow keys, Home and End", () => {
    const onChange = vi.fn();
    mount(<TabsHost onChange={onChange} />);
    const tabs = () => [...host.querySelectorAll('[role="tab"]')];
    expect(host.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe("Sound");
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    key(tabs()[0], "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("speed");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);
    key(tabs()[1], "End");
    expect(onChange).toHaveBeenLastCalledWith("sleep");
    expect(tabs()[2].getAttribute("tabindex")).toBe("0");
    expect(tabs()[0].getAttribute("tabindex")).toBe("-1");
    key(tabs()[2], "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("eq");
    key(tabs()[0], "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith("sleep");
    key(tabs()[2], "Home");
    expect(onChange).toHaveBeenLastCalledWith("eq");
  });
});
