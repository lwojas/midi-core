import type { ControlId } from "../../control-api/types/control.js";
import type { SurfaceContext } from "../../control-api/types/context.js";
import type { GridOffset, SurfaceModeId } from "./navigation.js";
import type { RgbColour } from "../../mapping/types/address.js";

/**
 * Declarative mode bindings (ECS-68): the "binding table" shape
 * `docs/control-surface-architecture.md`'s generation step
 * (`(DeviceProfile, binding table) -> ControlMapping[]`) left open. A
 * binding never carries MIDI address data of its own — only a
 * `PhysicalControl.id` to look up (`docs/contracts/device-profile.md`
 * already owns `input`/`feedback`) and a role/resolution pair the
 * generation step (ECS-72) turns into a `ControlMapping`
 * (`docs/contracts/mapping.md`). Re-authoring a note or CC number here
 * would be exactly the duplication the architecture doc already rules
 * out.
 */

/**
 * Owner-defined, like `ControlId`/`Selection.scope` — "pad grid",
 * "transport play", "track fader". Pure documentation: no resolution
 * logic reads `role` itself, the same way a `ControlDef.label` carries no
 * behavior. Kept because the architecture doc already frames the whole
 * generation step around assigning a role to each `PhysicalControl`.
 */
export type ControlRole = string;

/**
 * How a role's `ControlId` is resolved for the application's current
 * context — declarative data, never a function:
 *
 * - `"static"` — the common case: a role that always means the same
 *   `ControlId` regardless of selection (e.g. "transport play" ->
 *   `"transport.play"`).
 * - `"from-selection"` — a role whose target depends on the
 *   application's current `Selection` (`docs/contracts/control-api.md`):
 *   `{ kind: "from-selection", scope: "track", template: "track.{id}.volume" }`
 *   substitutes the current `Selection(scope: "track").id` for every
 *   `"{id}"` in `template`.
 *
 * One placeholder, no expression language beyond it — a role needing more
 * than substituting one selection's id, or any actual computation, is
 * exactly what `SurfaceModeHooks.resolveBindings` below is for, not a
 * richer template syntax here.
 */
export type ControlIdResolution =
  | { readonly kind: "static"; readonly controlId: ControlId }
  | { readonly kind: "from-selection"; readonly scope: string; readonly template: string };

/**
 * A surface-local action a binding triggers directly, instead of
 * resolving to an application `ControlId` — the hardware "next page"/
 * "previous page"/mode-select controls that `SurfaceNavigation`
 * (ECS-67, `docs/contracts/surface-navigation.md`) already owns.
 * Declarative for the same reason `ControlIdResolution` is: these are the
 * fixed gestures `pageBy()`/`setMode()` already define, not new behavior,
 * so no hook is needed for "navigation" at all — one of the ticket's four
 * named hook categories turns out not to need a hook.
 */
export type NavigationAction =
  | { readonly kind: "set-mode"; readonly mode: SurfaceModeId }
  /**
   * One page turn of `gridId`, in pages (`direction` of `{ column: 1 }` is one page right). The size of a
   * page is the grid's `paging` in its profile, not something the binding names (ECS-89).
   */
  | { readonly kind: "page"; readonly gridId: string; readonly direction: GridOffset };

interface ModeBindingBase {
  /** `PhysicalControl.id` (`docs/contracts/device-profile.md`) this binding assigns meaning to. */
  readonly physicalControlId: string;
  readonly role: ControlRole;
}

/**
 * What a press does: "hold" (the default) drives the control from the pad's own on/off, so it's on while held.
 * "toggle" flips the control on each press and ignores release (ECS-89), for a step or a mute.
 */
export type ControlPress = "hold" | "toggle";

export interface ControlBinding extends ModeBindingBase {
  readonly kind: "control";
  readonly resolve: ControlIdResolution;
  readonly press?: ControlPress;
  /** The colour the LED shows while the control is on, on an RGB LED (ECS-95). Omitted means white. */
  readonly colour?: RgbColour;
}

export interface NavigationBinding extends ModeBindingBase {
  readonly kind: "navigate";
  readonly navigate: NavigationAction;
}

/**
 * A physical grid (`ControlGrid`, by id) mapped onto a window of application controls
 * (ECS-89). Each physical cell drives the application control at its position in the
 * window the surface's current page offset selects. `template` names those application
 * controls with `{row}` and `{column}` placeholders, filled with the virtual coordinates
 * (page offset plus the cell's own position). `{track}` is the virtual row plus one, for
 * controls numbered from one (ECS-95). Pages are turned by a navigation binding, so
 * the binding is installed once per mode and never rebuilt on a page turn.
 *
 * Drives boolean controls (pads, buttons). A window over numeric controls is not modeled.
 */
export interface WindowedControlBinding extends ModeBindingBase {
  readonly kind: "window";
  readonly gridId: string;
  readonly template: string;
  readonly press?: ControlPress;
  /**
   * Which way the window's tracks run (ECS-95). "vertical" (the default): a cell's position is its row and column
   * offset by the page. "horizontal": the window's rows and columns trade places, so the page's tracks run across the
   * grid's columns and the page offset still moves by tracks, the way a mixer lays tracks out across the top.
   */
  readonly orientation?: "vertical" | "horizontal";
  /** The colour the LED shows while the cell is on, on an RGB LED (ECS-95). Omitted means white. */
  readonly colour?: RgbColour;
  /**
   * An application control holding how many columns the sequence has (ECS-89). Paging stops at the first
   * column and at the last window that still shows the end of the sequence. Omitted means no upper bound.
   */
  readonly columnCountControl?: string;
  /**
   * An application control holding how many rows the window pages through, such as the number of tracks (ECS-95).
   * Paging stops at the first row and at the last window that still shows the last row. Omitted means no upper bound.
   */
  readonly rowCountControl?: string;
}

/**
 * A button that shows whether the application is at one value (ECS-114): lit while the number control `resolve` names holds
 * `lit`, dark otherwise. It only sends feedback. The button's own presses are bound elsewhere (a bank action), so a press
 * never writes this control. Painted on enter and cleared on exit, like any LED.
 */
export interface IndicatorBinding extends ModeBindingBase {
  readonly kind: "indicator";
  readonly resolve: ControlIdResolution;
  /** The control value that lights the button. */
  readonly lit: number;
  /** The colour the LED shows while lit, on an RGB LED (ECS-95). Omitted means white. */
  readonly colour?: RgbColour;
}

/** One `PhysicalControl`'s assigned meaning within a mode — an application control to drive, a surface-local navigation action, a window onto a grid of controls, or an indicator of one value. */
export type ModeBinding = ControlBinding | NavigationBinding | WindowedControlBinding | IndicatorBinding;

/**
 * The two genuine escape valves a declarative `bindings` list can't
 * express — not a general scripting surface. Both optional; most modes
 * need neither. Named functions with narrow signatures, not a
 * string/expression DSL: this is a TypeScript library already consumed
 * by TypeScript integrations, so "no arbitrary JavaScript required"
 * means the *default* authoring path is data, not that a hook must avoid
 * being a function.
 */
export interface SurfaceModeHooks {
  /**
   * Runs once when entering this mode, before its `bindings` are bound —
   * for unusual initialization or a protocol quirk no declarative field
   * covers (e.g. a device-specific mode-select message that isn't part
   * of `DeviceSetup` because it happens on every mode switch, not
   * once at connection time). No `MidiOutput` is passed in: the same
   * device-specific-knowledge boundary `docs/contracts/device-setup.md` draws
   * — whoever supplies this hook supplies its own access to the device.
   */
  onEnter?(): Promise<void> | void;
  /** Runs once when leaving this mode, after its `bindings` are unbound — cleanup for whatever `onEnter` did. */
  onExit?(): Promise<void> | void;
  /**
   * Replaces `bindings` for a mode whose control set can't be fixed at
   * authoring time (e.g. one pad per currently-existing track). Returns
   * the same declarative `ModeBinding[]` shape `bindings` would have held
   * — a dynamic mode still produces data for the generation step (ECS-72)
   * to consume, not a second, imperative code path.
   */
  resolveBindings?(context: SurfaceContext): readonly ModeBinding[];
}

/**
 * One mode's complete binding table. Exactly one of `bindings`/
 * `hooks.resolveBindings` is expected to supply the mode's `ModeBinding`s
 * for a given attach — `bindings` for the common, fixed case,
 * `resolveBindings` for a dynamic one. Enforcing that isn't this
 * contract's job; see "What's deliberately not here" below.
 */
export interface SurfaceModeDefinition {
  readonly mode: SurfaceModeId;
  readonly bindings?: readonly ModeBinding[];
  readonly hooks?: SurfaceModeHooks;
  /**
   * Selecting something in the application with this scope switches the surface to this mode
   * (ECS-89): e.g. `{ scope: "track" }` puts the surface into mixer mode when a track is selected.
   * Only changes after attach() count. A surface's initial selection does not switch modes.
   */
  readonly activateOn?: { readonly scope: string };
  /**
   * Ports the mode needs (ECS-104). The surface refuses a switch to this mode while any of them isn't connected: the
   * `port-unavailable` error is reported and the surface stays in its mode. Omitted, the mode needs no port of its own.
   */
  readonly requiredPortIds?: readonly string[];
}

/** The full binding table `docs/control-surface-architecture.md`'s generation step consumes: one `SurfaceModeDefinition` per mode a surface supports. */
export type SurfaceBindingTable = readonly SurfaceModeDefinition[];

/**
 * Resolves a `ControlIdResolution` against the application's current
 * `SurfaceContext`. Returns `undefined` rather than throwing when
 * `"from-selection"` names a `scope` with nothing currently selected —
 * the same choice `docs/contracts/mapping.md`'s own resolution functions
 * make for an unsupported pairing: a binding authored (or dynamically
 * produced) for a selection that hasn't happened yet shouldn't be able to
 * take down a live mode switch.
 */
export function resolveControlId(resolution: ControlIdResolution, context: SurfaceContext): ControlId | undefined {
  if (resolution.kind === "static") {
    return resolution.controlId;
  }
  const selection = context.getSelection(resolution.scope);
  if (!selection) {
    return undefined;
  }
  return resolution.template.split("{id}").join(selection.id);
}
