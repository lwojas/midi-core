import type { Channel } from "../../core/types/message.js";
import type { ModeButtonRole } from "./layout.js";

/**
 * A device mode that needs its own messages and its own ports, on top of the device's main surface (ECS-96). The
 * Launchpad Mini MK3's DAW Fader layout is the first: it is only reachable after a DAW-mode message, and its faders
 * report and take their colours on the DAW ports.
 *
 * A mode is optional. A device without the ports it names gets no such mode, and the rest of its surface still works.
 * The sequencer sends `activate`, then each fader bank, then `showLayout`, because the layout can only show banks that
 * are already set up. Leaving sends `deactivate`.
 */
export interface DeviceModeProfile {
  /** Profile-document-scoped id, unique among modes. */
  readonly id: string;
  readonly description: string;
  /** `DevicePortProfile.id` of the output port the mode's messages go to. */
  readonly sendPortId: string;
  /** The mode exists only when every port listed here is present on the device. */
  readonly requiredPortIds: readonly string[];
  /** Messages sent to enter the mode, before the fader banks. Each is a complete SysEx message, F0 to F7. */
  readonly activate: readonly (readonly number[])[];
  /** The message that shows the mode's layout, sent after the fader banks. A complete SysEx message, F0 to F7. */
  readonly showLayout: readonly number[];
  /** Messages sent to leave the mode. Each is a complete SysEx message, F0 to F7. */
  readonly deactivate: readonly (readonly number[])[];
  /**
   * The SysEx bytes that open a fader bank message, from F0. The sequencer appends one entry per fader, then F7. The
   * bank's orientation byte is the last byte of this prefix.
   */
  readonly bankPrefix: readonly number[];
  /**
   * The values of one fader's entry in a bank message, in the order the device expects (ECS-99). Each field appears
   * once. The sequencer writes the entries for a bank's faders one after another, after `bankPrefix`.
   */
  readonly bankEntry: readonly BankEntryField[];
  /** The byte a fader's entry carries for a unipolar bank, and for a bipolar one (ECS-99). */
  readonly bankTypes: { readonly unipolar: number; readonly bipolar: number };
  /**
   * The buttons that switch modes while this mode is active. They are read on this mode's own ports, because the device
   * sends them there in this layout (for the Launchpad, the DAW port, not the main one).
   */
  readonly modeButtons?: readonly ModeButtonRole[];
  /**
   * The arrows that page through the application's tracks while this mode is active (ECS-96). They are actions for the
   * application to handle, not navigation: the application owns which tracks the faders show. Read on this mode's ports.
   */
  readonly pageButtons?: DeviceModePageButtons;
  /**
   * True when the device forgets its fader setup on a page turn, so the bank is resent before the application moves its
   * tracks (ECS-101). Each page arrow then sends the bank again. False, the page turn sends nothing to the device.
   */
  readonly resendBankOnPageTurn: boolean;
  readonly faders: DeviceFaderSet;
}

/**
 * A value in one fader's entry of a bank message (ECS-99): the fader's position in its bank (`index`), its type
 * (`type`, from `bankTypes`), its CC (`controller`), or its colour (`colour`).
 */
export type BankEntryField = "index" | "type" | "controller" | "colour";

/** The control ids of a mode's page arrows. Each is optional: a button left out has no binding. */
export interface DeviceModePageButtons {
  readonly pageUp?: string;
  readonly pageDown?: string;
  readonly pageLeft?: string;
  readonly pageRight?: string;
}

/**
 * The faders a mode exposes. Fader moves arrive on `inputPortId` on `inputChannel`, and a fader's colour is set on
 * `feedbackPortId` on `feedbackChannel`, with the fader's index as the controller. Each bank is a fixed set of CCs,
 * one per fader, that the device reports on; the sequencer sends a bank to the device to make its CCs live.
 */
export interface DeviceFaderSet {
  readonly inputPortId: string;
  readonly inputChannel: Channel;
  readonly feedbackPortId: string;
  readonly feedbackChannel: Channel;
  readonly banks: readonly DeviceFaderBank[];
}

/**
 * One bank of faders: a fixed CC per fader, left to right, so a bank holds 1 to 8 faders. `bipolar` is true for a
 * centred control such as pan. `colour` is the palette entry the faders show when the bank is set up (1-127; 0 would
 * switch a fader off).
 */
export interface DeviceFaderBank {
  /** Profile-document-scoped id, unique among the banks of its mode. Names the bank in the application contract's `faderTemplates`. */
  readonly id: string;
  /** The id of the mode that shows this bank, unique across the profile's banks (ECS-100), e.g. `faders-volume`. */
  readonly modeId: string;
  readonly bipolar: boolean;
  readonly colour: number;
  /** One CC per fader, 0-127, all different. */
  readonly controllers: readonly number[];
  /** The control id of each fader, parallel to `controllers` and unique across the profile (ECS-100), e.g. `fader-volume-0`. */
  readonly controlIds: readonly string[];
}
