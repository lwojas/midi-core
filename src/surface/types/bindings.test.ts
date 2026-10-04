import { describe, expect, it } from "vitest";
import { resolveControlId, type ControlIdResolution } from "./bindings.js";
import type { Selection, SurfaceContext } from "../../control-api/types/context.js";

function createContext(selections: readonly Selection[]): SurfaceContext {
  return {
    listSelections: () => selections,
    getSelection: (scope) => selections.find((selection) => selection.scope === scope),
    onChange: () => () => {},
  };
}

describe("resolveControlId", () => {
  it("returns the fixed controlId for a static resolution, ignoring context", () => {
    const resolution: ControlIdResolution = { kind: "static", controlId: "transport.play" };
    expect(resolveControlId(resolution, createContext([]))).toBe("transport.play");
  });

  it("substitutes the current selection's id into the template for a from-selection resolution", () => {
    const resolution: ControlIdResolution = {
      kind: "from-selection",
      scope: "track",
      template: "track.{id}.volume",
    };
    const context = createContext([{ scope: "track", id: "3" }]);
    expect(resolveControlId(resolution, context)).toBe("track.3.volume");
  });

  it("substitutes every occurrence of the placeholder", () => {
    const resolution: ControlIdResolution = {
      kind: "from-selection",
      scope: "track",
      template: "{id}.track.{id}",
    };
    const context = createContext([{ scope: "track", id: "7" }]);
    expect(resolveControlId(resolution, context)).toBe("7.track.7");
  });

  it("returns undefined when the named scope has no current selection", () => {
    const resolution: ControlIdResolution = {
      kind: "from-selection",
      scope: "track",
      template: "track.{id}.volume",
    };
    expect(resolveControlId(resolution, createContext([]))).toBeUndefined();
  });

  it("only reads the scope it names, not any other current selection", () => {
    const resolution: ControlIdResolution = {
      kind: "from-selection",
      scope: "pattern",
      template: "pattern.{id}.step",
    };
    const context = createContext([{ scope: "track", id: "3" }]);
    expect(resolveControlId(resolution, context)).toBeUndefined();
  });
});
