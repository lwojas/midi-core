import { describe, expect, it, vi } from "vitest";
import { createAction } from "./action.js";
import type { ActionDef } from "./types/action.js";

const playDef: ActionDef = { id: "transport.play", label: "Play" };

describe("createAction", () => {
  it("invoke() calls the supplied callback", () => {
    const onInvoke = vi.fn();
    const action = createAction(playDef, onInvoke);

    action.invoke();

    expect(onInvoke).toHaveBeenCalledTimes(1);
  });

  it("invoke() can be called more than once", () => {
    const onInvoke = vi.fn();
    const action = createAction(playDef, onInvoke);

    action.invoke();
    action.invoke();

    expect(onInvoke).toHaveBeenCalledTimes(2);
  });

  it("exposes the given def unchanged", () => {
    const action = createAction(playDef, () => {});
    expect(action.def).toBe(playDef);
  });
});
