// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Cover } from "./Cover";
import { EmptyState } from "./EmptyState";
import { Enter } from "./Enter";
import { Row } from "./Row";
import { Slider } from "./Slider";
import { TextField } from "./TextField";
import { useScrollActivity } from "./useScrollActivity";

const covers = vi.hoisted(() => ({ coverSrc: vi.fn((src: string) => src) }));
vi.mock("../ports/covers", () => covers);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  covers.coverSrc.mockClear();
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
const tooltip = () => document.body.querySelector('[role="tooltip"]');

describe("Cover", () => {
  it("draws the placeholder and no img for an empty src", () => {
    mount(<Cover src="" size={40} />);
    const box = host.firstElementChild as HTMLElement;
    expect(box.style.width).toBe("40px");
    expect(box.style.height).toBe("40px");
    expect(host.querySelector("img")).toBeNull();
  });

  it("retries once after 250 ms, then keeps the placeholder (covers test 28)", () => {
    vi.useFakeTimers();
    const url = "https://i.ytimg.com/vi/id/hqdefault.jpg";
    mount(<Cover src={url} size={40} />);
    const first = host.querySelector("img")!;
    expect(first.getAttribute("src")).toBe(url);
    expect(first.hasAttribute("crossorigin")).toBe(false);
    expect(first.width).toBe(40);
    expect(first.getAttribute("loading")).toBe("lazy");

    fire(first, new Event("error"));
    expect(host.querySelector("img")).toBe(first);
    act(() => vi.advanceTimersByTime(250));
    const second = host.querySelector("img")!;
    expect(second).not.toBe(first);
    expect(second.getAttribute("src")).toBe(url);

    fire(second, new Event("error"));
    expect(host.querySelector("img")).toBeNull();
    expect((host.firstElementChild as HTMLElement).style.width).toBe("40px");
  });

  it("asks again after a remount (covers test 29)", () => {
    const url = "https://i.ytimg.com/vi/id/hqdefault.jpg";
    mount(<Cover src={url} size={40} />);
    fire(host.querySelector("img")!, new Event("error"));
    fire(host.querySelector("img")!, new Event("error"));
    act(() => root.unmount());
    root = createRoot(host);
    mount(<Cover src={url} size={40} />);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(url);
  });

  it("marks the image loaded", () => {
    mount(<Cover src="https://i.ytimg.com/a.jpg" size={40} />);
    const image = host.querySelector("img")!;
    fire(image, new Event("load"));
    expect(image.dataset.loaded).toBe("");
  });

  it("asks for the drawn size, loads lazily, decodes off the main thread and can ask for low priority", () => {
    const url = "https://i.ytimg.com/vi/id/hqdefault.jpg";
    mount(<Cover src={url} size={40} fetchPriority="low" />);
    expect(covers.coverSrc).toHaveBeenCalledWith(url, 40, window.devicePixelRatio);
    const image = host.querySelector("img")!;
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("fetchpriority")).toBe("low");
    mount(<Cover src={url} size={200} />);
    expect(host.querySelector("img")!.hasAttribute("fetchpriority")).toBe(false);
  });

  it("takes its radius from the size, or a circle", () => {
    mount(<Cover src="https://i.ytimg.com/a.jpg" size={200} />);
    expect((host.firstElementChild as HTMLElement).style.borderRadius).toBe("6px");
    mount(<Cover src="https://i.ytimg.com/a.jpg" size={200} shape="circle" />);
    expect((host.firstElementChild as HTMLElement).style.borderRadius).toBe("50%");
  });
});

describe("Row", () => {
  it("activates on Enter and Space", () => {
    const onActivate = vi.fn();
    mount(<Row title="Song" onActivate={onActivate} />);
    const row = host.querySelector('[role="button"]')!;
    key(row, "Enter");
    key(row, " ");
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("keeps the actions in a container hidden until hover or focus", () => {
    const onActivate = vi.fn();
    mount(<Row title="Song" onActivate={onActivate} actions={<button type="button">More</button>} />);
    const actions = host.querySelector("button")!.parentElement!;
    expect(actions.className).toContain("actions");
    key(host.querySelector("button")!, "Enter");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("shows the unavailable reason in a tooltip on focus and does not activate", () => {
    const onActivate = vi.fn();
    mount(<Row title="Song" onActivate={onActivate} unavailableReason="Not available offline" />);
    const row = host.querySelector('[role="button"]') as HTMLElement;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    act(() => row.focus());
    expect(tooltip()?.textContent).toBe("Not available offline");
    key(row, "Enter");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("puts a long Russian title in the one-line ellipsis element", () => {
    const title = "Очень длинное название песни, которое не помещается в строку";
    expect(title.length).toBe(60);
    mount(<Row title={title} subtitle="Исполнитель" />);
    const element = [...host.querySelectorAll("span")].find((node) => node.textContent === title)!;
    expect(element.className).toContain("title");
  });
});

describe("TextField", () => {
  function Controlled({ onChange, onClear }: { onChange: (value: string) => void; onClear: () => void }) {
    const [value, setValue] = useState("");
    return (
      <TextField
        label="Search"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        onClear={() => {
          setValue("");
          onClear();
        }}
      />
    );
  }

  it("reports typing and clears with the button", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    mount(<Controlled onChange={onChange} onClear={onClear} />);
    const input = host.querySelector("input")!;
    expect(host.querySelector("button")).toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "abba");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("abba");
    const clear = host.querySelector("button")!;
    act(() => clear.click());
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("Slider", () => {
  function Controlled({ format }: { format?: (value: number) => string }) {
    const [value, setValue] = useState(50);
    return <Slider label="Volume" value={value} min={0} max={100} step={5} onChange={setValue} format={format} />;
  }

  it("steps with the arrows and pages, and uses format for the text", () => {
    mount(<Controlled format={(value) => `${value} %`} />);
    const slider = host.querySelector('[role="slider"]')!;
    key(slider, "ArrowRight");
    expect(slider.getAttribute("aria-valuenow")).toBe("55");
    expect(slider.getAttribute("aria-valuetext")).toBe("55 %");
    key(slider, "PageDown");
    expect(slider.getAttribute("aria-valuenow")).toBe("5");
    key(slider, "ArrowLeft");
    key(slider, "ArrowLeft");
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    key(slider, "End");
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    expect(host.textContent).toContain("100 %");
  });
});

describe("EmptyState", () => {
  it("renders the title, the message and the actions in order", () => {
    mount(
      <EmptyState
        title="Nothing here yet"
        message="Liked songs land here."
        actions={[
          { label: "Import", onClick: () => {} },
          { label: "Search", onClick: () => {}, primary: true },
        ]}
      />,
    );
    expect(host.textContent).toContain("Nothing here yet");
    expect(host.textContent).toContain("Liked songs land here.");
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Import", "Search"]);
  });

  it("fills its area and gives the tour the type and actions inside it, not the whole area", () => {
    mount(<EmptyState title="Your library is empty" tour="library-import" actions={[{ label: "Import", onClick: () => {} }]} />);
    const area = host.querySelector("[data-empty-state]")!;
    const outlined = host.querySelector('[data-tour="library-import"]')!;
    expect(area.contains(outlined)).toBe(true);
    expect(outlined).not.toBe(area);
    expect(outlined.querySelector("h2")?.textContent).toBe("Your library is empty");
    expect(outlined.querySelector("button")?.textContent).toBe("Import");
  });
});

describe("Enter", () => {
  it("rises on the first visit of a screen only, with the index capped at 5", () => {
    mount(
      <>
        <Enter index={0} screen="x">
          <p>a</p>
        </Enter>
        <Enter index={9} screen="x">
          <p>b</p>
        </Enter>
      </>,
    );
    const [first, second] = [...host.children] as HTMLElement[];
    expect(first.className).toContain("n-enter");
    expect(first.style.getPropertyValue("--n-i")).toBe("0");
    expect(second.style.getPropertyValue("--n-i")).toBe("5");

    mount(null);
    mount(
      <Enter index={0} screen="x">
        <p>a</p>
      </Enter>,
    );
    expect((host.firstElementChild as HTMLElement).className).not.toContain("n-enter");
  });
});

describe("useScrollActivity", () => {
  function Scroller() {
    const ref = useRef<HTMLDivElement>(null);
    useScrollActivity(ref);
    return <div ref={ref} />;
  }

  it("marks the container while scrolling and clears it 800 ms after the last scroll", () => {
    vi.useFakeTimers();
    mount(<Scroller />);
    const scroller = host.firstElementChild!;
    fire(scroller, new Event("scroll"));
    expect(scroller.hasAttribute("data-scrolling")).toBe(true);
    act(() => vi.advanceTimersByTime(500));
    fire(scroller, new Event("scroll"));
    act(() => vi.advanceTimersByTime(799));
    expect(scroller.hasAttribute("data-scrolling")).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(scroller.hasAttribute("data-scrolling")).toBe(false);
  });
});
