/**
 * A fire-and-forget application command — transport play/stop, trigger a
 * step, start recording — as opposed to a Control's persistent, readable
 * value. Invoking one has an effect but no value to read back: `invoke()`
 * returns nothing, and there is deliberately no `getValue()`/`onChange()`
 * pair here. Anything with a value to observe (e.g. playback *status*, as
 * opposed to the "play" command) is a Control, not an Action — this type
 * exists only for the commands a Control's read/write/observe shape doesn't
 * fit.
 */

export type ActionId = string;

export interface ActionDef {
  readonly id: ActionId;
  /** Human-readable label, e.g. for a UI or a MIDI-mapping picker. */
  readonly label: string;
}

export interface Action {
  readonly def: ActionDef;
  invoke(): void;
}
