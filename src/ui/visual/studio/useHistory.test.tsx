// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHistory } from "./useHistory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const probe = {} as { value: string; history: ReturnType<typeof useHistory<string>> };

function Probe() {
  const [current, setCurrent] = useState("a");
  const history = useHistory(current, setCurrent);
  useEffect(() => {
    probe.value = current;
    probe.history = history;
  });
  return null;
}

beforeEach(() => {
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
});

afterEach(() => act(() => root.unmount()));

describe("studio history", () => {
  it("undoes and redoes commits in order", () => {
    act(() => probe.history.commit("b"));
    act(() => probe.history.commit("c"));
    act(() => probe.history.undo());
    expect(probe.value).toBe("b");
    act(() => probe.history.undo());
    expect(probe.value).toBe("a");
    expect(probe.history.canUndo).toBe(false);
    act(() => probe.history.redo());
    expect(probe.value).toBe("b");
  });

  it("drops the redo list when something new is committed", () => {
    act(() => probe.history.commit("b"));
    act(() => probe.history.undo());
    act(() => probe.history.commit("z"));
    expect(probe.value).toBe("z");
    expect(probe.history.canRedo).toBe(false);
  });
});
