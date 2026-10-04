import { describe, expect, it, vi } from "vitest";
import { createSurfaceContext } from "./context.js";

describe("createSurfaceContext", () => {
  it("starts with the given initial selections", () => {
    const context = createSurfaceContext([{ scope: "track", id: "track-1" }]);

    expect(context.getSelection("track")).toEqual({ scope: "track", id: "track-1" });
    expect(context.listSelections()).toEqual([{ scope: "track", id: "track-1" }]);
  });

  it("getSelection returns undefined for a scope with nothing selected", () => {
    expect(createSurfaceContext().getSelection("track")).toBeUndefined();
  });

  it("setSelection notifies listeners with the new selection", () => {
    const context = createSurfaceContext();
    const listener = vi.fn();
    context.onChange(listener);

    context.setSelection({ scope: "track", id: "track-3" });

    expect(context.getSelection("track")).toEqual({ scope: "track", id: "track-3" });
    expect(listener).toHaveBeenCalledWith({ scope: "track", id: "track-3" });
  });

  it("setSelection for one scope doesn't disturb another scope's selection", () => {
    const context = createSurfaceContext([{ scope: "track", id: "track-1" }]);

    context.setSelection({ scope: "pattern", id: "pattern-2" });

    expect(context.getSelection("track")).toEqual({ scope: "track", id: "track-1" });
    expect(context.getSelection("pattern")).toEqual({ scope: "pattern", id: "pattern-2" });
    expect(context.listSelections()).toHaveLength(2);
  });

  it("setSelection replaces a scope's previous selection", () => {
    const context = createSurfaceContext([{ scope: "track", id: "track-1" }]);

    context.setSelection({ scope: "track", id: "track-2" });

    expect(context.getSelection("track")).toEqual({ scope: "track", id: "track-2" });
    expect(context.listSelections()).toHaveLength(1);
  });
});
