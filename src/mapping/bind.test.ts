import { describe, expect, it } from "vitest";
import { MockMidiInput } from "../adapters/mock/mock-input.js";
import { MockMidiOutput } from "../adapters/mock/mock-output.js";
import { createMidiInput } from "../core/input/create-midi-input.js";
import { createMidiOutput } from "../core/output/create-midi-output.js";
import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef } from "../control-api/types/control.js";
import type { ControlMapping } from "./types/mapping.js";
import { bindControlMapping } from "./bind.js";

/**
 * A minimal, generic in-memory Control -- exactly the test double ECS-34/35
 * explicitly left out of the Control API contract. Local to this test file:
 * proving the mapping runtime works needs *some* concrete Control, but
 * supplying one is this ticket's concern, not the Control API's.
 */
function createTestControl<D extends ControlDef>(def: D): Control<D> {
  let value = def.default as ControlValue<D>;
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();

  return {
    def,
    getValue: () => value,
    setValue: (next) => {
      const previous = value;
      value = next;
      for (const listener of listeners) listener(value, previous);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A Control whose setValue() does NOT notify onChange() listeners synchronously -- it queues
 * the write, and a separate test-only flushOne() applies exactly one queued write and fires
 * onChange for it. Models a Control backed by something like UI framework state (dispatch
 * now, notify on a later render), the shape that surfaced the real ECS-57 lag bug: several
 * MIDI messages can each call setValue() before the first one's onChange ever fires.
 */
function createDeferredTestControl<D extends ControlDef>(def: D) {
  let current = def.default as ControlValue<D>;
  const pendingWrites: ControlValue<D>[] = [];
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();

  const control: Control<D> = {
    def,
    getValue: () => current,
    setValue: (next) => pendingWrites.push(next),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    control,
    pendingWriteCount: () => pendingWrites.length,
    /** Applies exactly one queued setValue() and fires onChange for it, as if one render/
     * effect cycle just caught up with one pending state update. No-op if nothing is queued. */
    flushOne: () => {
      if (pendingWrites.length === 0) return;
      const next = pendingWrites.shift()!;
      const previous = current;
      current = next;
      for (const listener of listeners) listener(current, previous);
    },
    /** Drops every queued write except the last and fires onChange once for it, as if a UI
     * framework batched several state updates (from several setValue() calls) into a single
     * render -- intermediate values are never individually confirmed. No-op if nothing is
     * queued. */
    flushCoalesced: () => {
      if (pendingWrites.length === 0) return;
      const next = pendingWrites[pendingWrites.length - 1]!;
      pendingWrites.length = 0;
      const previous = current;
      current = next;
      for (const listener of listeners) listener(current, previous);
    },
  };
}

const cutoff: NumericControlDef = {
  id: "fx.filter.cutoff",
  label: "Cutoff",
  kind: "number",
  min: 40,
  max: 18000,
  step: 1,
  unit: "Hz",
  default: 40,
};

const muted: BooleanControlDef = {
  id: "track.1.muted",
  label: "Mute",
  kind: "boolean",
  default: false,
};

function wiredPorts() {
  const rawInput = new MockMidiInput({ id: "in-1", type: "input", name: "Mock In", manufacturer: null });
  const rawOutput = new MockMidiOutput({ id: "out-1", type: "output", name: "Mock Out", manufacturer: null });
  return { rawInput, rawOutput, input: createMidiInput(rawInput), output: createMidiOutput(rawOutput) };
}

describe("bindControlMapping — MIDI -> Control", () => {
  it("pushes a resolved CC value into the control", () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127)); // CC 74, channel 0, value 127

    expect(control.getValue()).toBe(18000);
  });

  it("ignores a message that doesn't match the mapping's source", () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 75, 127)); // different controller

    expect(control.getValue()).toBe(cutoff.default);
  });

  it("stops updating the control once unbound", () => {
    const { rawInput, input, output } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    const unbind = bindControlMapping(mapping, input, output, control);
    unbind();
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127));

    expect(control.getValue()).toBe(cutoff.default);
  });
});

describe("bindControlMapping — Control -> MIDI (feedback)", () => {
  it("sends feedback when the control changes", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    control.setValue(18000);

    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 20, 127]);
  });

  it("sends nothing for a mapping with no feedback target", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
    };

    bindControlMapping(mapping, input, output, control);
    control.setValue(18000);

    expect(rawOutput.sentMessages).toHaveLength(0);
  });

  it("stops sending feedback once unbound", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const mapping: ControlMapping = {
      id: "note36-mute",
      control: muted.id,
      source: { address: { type: "note", note: 36 }, channel: "any" },
      feedback: { address: { type: "note", note: 36 }, channel: 0 },
    };

    const unbind = bindControlMapping(mapping, input, output, control);
    unbind();
    control.setValue(true);

    expect(rawOutput.sentMessages).toHaveLength(0);
  });
});

describe("bindControlMapping — echo suppression (ECS-57)", () => {
  it("does not echo feedback for the value an incoming message itself just set", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127)); // CC 74 -> cutoff = 18000

    expect(control.getValue()).toBe(18000);
    expect(rawOutput.sentMessages).toHaveLength(0); // no echo back out for the value MIDI just set
  });

  it("still sends feedback for a change from any other origin (e.g. a UI call to setValue)", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127)); // suppressed, per the test above
    control.setValue(40); // a non-MIDI caller (e.g. a UI) changes the control afterward

    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 20, 0]); // feedback for the 40 value
  });

  it("only suppresses the one onChange immediately caused by its own setValue(), not later ones", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const control = createTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 127)); // suppressed: cutoff -> 18000
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 0)); // a second message, consumes/resets suppression: cutoff -> 40
    control.setValue(18000); // a non-MIDI caller sets the SAME value the first message used

    // The first message's suppression was already consumed by the second message's own
    // onChange; this later, unrelated setValue(18000) is not treated as that old echo.
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 20, 127]);
  });
});

describe("bindControlMapping — echo suppression under a lagging Control (ECS-57 regression)", () => {
  // Reproduces a bug found integrating against a real Launchpad Mini fader: several CC
  // messages arrived (each calling setValue()) before the *first* one's onChange ever fired,
  // because the Control (there, UI framework state) notifies on a later render, not
  // synchronously. A single "remember the last value" slot gets overwritten by the later
  // messages before the earlier one is confirmed, so the earlier confirmation no longer
  // matches when it finally arrives -- and leaks through as feedback for a stale value.
  it("suppresses every queued message's echo even when confirmations arrive well behind the input stream", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const { control, flushOne, pendingWriteCount } = createDeferredTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);

    // Four incoming messages arrive back to back, well before any of them is confirmed.
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 100));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 90));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 80));
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 70));
    expect(pendingWriteCount()).toBe(4);

    // Confirmations trickle in one at a time, in the same order -- each must still be
    // recognized as this mapping's own echo, no matter how far behind it's fallen.
    flushOne();
    flushOne();
    flushOne();
    flushOne();

    expect(rawOutput.sentMessages).toHaveLength(0);
  });

  it("still sends feedback for a non-MIDI change queued behind lagging MIDI confirmations", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const { control, flushOne } = createDeferredTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 100)); // queued, not yet confirmed
    rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, 90)); // queued, not yet confirmed
    control.setValue(40); // a UI change, called after both MIDI messages but also not yet confirmed

    // Confirmations land in the same order the three setValue() calls above were made.
    flushOne(); // confirms the first MIDI message (100) -- still correctly suppressed
    flushOne(); // confirms the second MIDI message (90) -- still correctly suppressed
    expect(rawOutput.sentMessages).toHaveLength(0);

    flushOne(); // confirms the UI's 40 -- nothing left in the MIDI queue to match it against
    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0xb0, 20, 0]);
  });

  // Reproduces the real failure mode measured against a Launchpad Mini fader directly (not
  // through any UI): it sends CC in bursts of several messages ~1ms apart, then pauses
  // 200-450ms. A render cycle easily keeps up during the pause but not within a burst, so one
  // render/onChange ends up confirming the *final* value of a whole burst -- not each queued
  // value individually. Matching only the front of the queue (an earlier, intermediate fix)
  // left the skipped earlier entries permanently stuck, leaking every later burst's
  // confirmation through as feedback. Matching anywhere in the queue, and dropping everything
  // up to the match, is what actually fixes it.
  it("suppresses a single coalesced confirmation that accounts for a whole burst of messages", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const { control, flushCoalesced } = createDeferredTestControl(cutoff);
    const mapping: ControlMapping = {
      id: "cc74-cutoff",
      control: cutoff.id,
      source: { address: { type: "control-change", controller: 74 }, channel: "any" },
      feedback: { address: { type: "control-change", controller: 20 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);

    // A burst: several CC messages land before even one render catches up.
    for (const nativeValue of [100, 102, 104, 105, 107, 109, 110, 112]) {
      rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, nativeValue));
    }
    flushCoalesced(); // one render confirms only the burst's final value (112)

    expect(rawOutput.sentMessages).toHaveLength(0);

    // The next burst (direction reversed, as on a real drag) is still handled correctly --
    // the queue isn't left corrupted by the previous burst's coalescing.
    for (const nativeValue of [110, 108, 106, 104]) {
      rawInput.emitRawMessage(Uint8Array.of(0xb0, 74, nativeValue));
    }
    flushCoalesced();

    expect(rawOutput.sentMessages).toHaveLength(0);
  });
});

describe("bindControlMapping — round trip", () => {
  it("a Launchpad-style pad press updates a control without echoing back to the same pad", () => {
    const { rawInput, input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const mapping: ControlMapping = {
      id: "note36-mute",
      control: muted.id,
      source: { address: { type: "note", note: 36 }, channel: "any" },
      feedback: { address: { type: "note", note: 36 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    rawInput.emitRawMessage(Uint8Array.of(0x90, 36, 127)); // Note On, channel 0 -- the pad itself

    expect(control.getValue()).toBe(true);
    expect(rawOutput.sentMessages).toHaveLength(0); // ECS-57: no echo back to the pad that just pressed it
  });

  it("a mute change from elsewhere still lights/unlights the pad via feedback", () => {
    const { input, output, rawOutput } = wiredPorts();
    const control = createTestControl(muted);
    const mapping: ControlMapping = {
      id: "note36-mute",
      control: muted.id,
      source: { address: { type: "note", note: 36 }, channel: "any" },
      feedback: { address: { type: "note", note: 36 }, channel: 0 },
    };

    bindControlMapping(mapping, input, output, control);
    control.setValue(true); // e.g. a UI mute button, not the pad

    expect(Array.from(rawOutput.sentMessages[0]!)).toEqual([0x90, 36, 127]); // note-on lights the pad
  });
});
