import { decodeMidiMessage, encodeMidiMessage } from "../core/message/codec.js";
import type { Channel, MidiMessage } from "../core/types/message.js";
import type { ControlAddress, PhysicalControl } from "../profile/types/control.js";
import type { MockSurfaceDevice } from "./mock-surface-device.js";

/**
 * Inspects and drives a `MockSurfaceDevice` by `PhysicalControl` id,
 * reading each control's declared `input`/`feedback` address off the
 * profile instead of a test hand-encoding raw bytes — "a harness to
 * inspect input and feedback without real hardware or Launchpad-specific
 * knowledge" means a test that presses `"pad-3"` never needs to know pad
 * 3 is note 39.
 */
export interface MockSurfaceHarness {
  /** Simulates a note-on for a note-addressed input control (a button or pad). Throws if the control's `input` isn't a `"note"` address. */
  press(physicalControlId: string, velocity?: number): void;
  /** Simulates a note-off for a note-addressed input control. Throws if the control's `input` isn't a `"note"` address. */
  release(physicalControlId: string, velocity?: number): void;
  /** Simulates a control-change for a CC-addressed input control (a knob). Throws if the control's `input` isn't a `"control-change"` address. */
  turnKnob(physicalControlId: string, value: number): void;

  /** Every message sent through `output` so far, decoded, in order. */
  decodedFeedback(): readonly MidiMessage[];
  /** The most recent decoded feedback message matching `physicalControlId`'s declared `feedback` address, if any was sent. */
  lastFeedbackFor(physicalControlId: string): MidiMessage | undefined;
}

export function createMockSurfaceHarness(device: MockSurfaceDevice): MockSurfaceHarness {
  const { profile, input, output } = device;

  function findControl(physicalControlId: string): PhysicalControl {
    const control = profile.controls.find((candidate) => candidate.id === physicalControlId);
    if (!control) {
      throw new Error(`No PhysicalControl "${physicalControlId}" on this profile.`);
    }
    return control;
  }

  function requireInputAddress(physicalControlId: string): ControlAddress {
    const control = findControl(physicalControlId);
    if (!control.input) {
      throw new Error(`PhysicalControl "${physicalControlId}" has no input address.`);
    }
    return control.input;
  }

  return {
    press(physicalControlId, velocity = 127) {
      input.emitRawMessage(encodeMidiMessage(noteMessage(requireInputAddress(physicalControlId), true, velocity)));
    },
    release(physicalControlId, velocity = 0) {
      input.emitRawMessage(encodeMidiMessage(noteMessage(requireInputAddress(physicalControlId), false, velocity)));
    },
    turnKnob(physicalControlId, value) {
      input.emitRawMessage(encodeMidiMessage(controlChangeMessage(requireInputAddress(physicalControlId), value)));
    },
    decodedFeedback() {
      return output.sentMessages.map(decodeMidiMessage);
    },
    lastFeedbackFor(physicalControlId) {
      const control = findControl(physicalControlId);
      if (!control.feedback) return undefined;
      const matches = output.sentMessages.map(decodeMidiMessage).filter((message) => matchesAddress(message, control.feedback!.address));
      return matches[matches.length - 1];
    },
  };
}

function requireChannel(address: ControlAddress): Channel {
  if (address.channel === undefined) {
    throw new Error(`Address has no resolved channel; the harness can't simulate an unresolved control.`);
  }
  return address.channel;
}

function noteMessage(address: ControlAddress, on: boolean, velocity: number): MidiMessage {
  if (address.address.type !== "note") {
    throw new Error(`Expected a "note" address, got "${address.address.type}".`);
  }
  const channel = requireChannel(address);
  return on
    ? { type: "note-on", channel, note: address.address.note, velocity }
    : { type: "note-off", channel, note: address.address.note, velocity };
}

function controlChangeMessage(address: ControlAddress, value: number): MidiMessage {
  if (address.address.type !== "control-change") {
    throw new Error(`Expected a "control-change" address, got "${address.address.type}".`);
  }
  const channel = requireChannel(address);
  return { type: "control-change", channel, controller: address.address.controller, value };
}

function matchesAddress(message: MidiMessage, address: ControlAddress): boolean {
  const channel = address.channel;
  switch (address.address.type) {
    case "note":
      return (
        (message.type === "note-on" || message.type === "note-off") &&
        message.note === address.address.note &&
        (channel === undefined || message.channel === channel)
      );
    case "control-change":
      return message.type === "control-change" && message.controller === address.address.controller && (channel === undefined || message.channel === channel);
    default:
      return false;
  }
}
