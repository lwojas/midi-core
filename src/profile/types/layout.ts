/**
 * Which of a device's controls play which sequencer role (ECS-90). A profile says what a device has (controls,
 * grids); its layout says which of those controls the application's surface uses for what. Every id here names a
 * `PhysicalControl` on the same profile. A device with no layout still works: the configuration reports that and
 * builds the rest of its surface.
 *
 * The step grid is not named here. It is the profile's grid with `paging`, and track mutes are that grid's top row.
 */
export interface ModeButtonRole {
  /** The `PhysicalControl.id` of the button. */
  readonly controlId: string;
  /** The surface mode this button switches to. */
  readonly mode: string;
  /**
   * The same physical button's control id on the device's main input, when `controlId` names a control on a
   * different port (ECS-126). Some devices can be forced back to their stock input/output pair by the user, outside
   * any message the surface sees — the Launchpad Mini MK3's Setup-menu combo (hold Session, then the bottom
   * side-column button) always returns Programmer mode, documented in `docs/hardware-validation.md`. That silently
   * moves this button's reports from `controlId`'s port back to the main one, so a mode whose own exit control lives
   * on a different port would otherwise never hear it again. Binding `recoveryControlId` too means the same button's
   * press still reaches the surface however the device is currently reporting it, resyncing navigation instead of
   * leaving it stuck on a mode whose own port has gone quiet.
   */
  readonly recoveryControlId?: string;
  /**
   * Light this button's own LED while `mode` is the surface's active mode (ECS-138), using the feedback the profile
   * already declares for it. Omitted (the default) sends no new feedback for this button at all, reproducing the
   * exact prior behavior for every profile authored before this field existed -- a device opts in explicitly,
   * since lighting a mode button is new outgoing traffic no profile declaring it has necessarily had re-verified on
   * hardware yet.
   */
  readonly indicator?: boolean;
}

export interface TransportRoles {
  readonly play?: string;
  readonly stop?: string;
  readonly record?: string;
  readonly clear?: string;
}

/**
 * Bank buttons (ECS-114). `previous` and `next` step through the banks; `select` has one button per bank, keyed by the
 * bank's index (0 = A). A button left out has no binding. A device sends these as a note or a CC; the profile's own
 * `input` says which, and the application never sees the difference.
 */
export interface BankRoles {
  readonly previous?: string;
  readonly next?: string;
  readonly select?: Readonly<Record<number, string>>;
}

export interface DeviceLayout {
  /** Mode buttons, in order. Each switches the surface to its mode and is available in every mode. */
  readonly modeButtons?: readonly ModeButtonRole[];
  /**
   * Page buttons, one each side of the grid. Left and right page through time (steps); up and down page through
   * tracks (rows). A side left out has no page binding.
   */
  readonly pageLeft?: string;
  readonly pageRight?: string;
  readonly pageUp?: string;
  readonly pageDown?: string;
  /** Transport buttons. A button left out has no binding. */
  readonly transport?: TransportRoles;
  /** Bank buttons (ECS-114). A device with none has no bank binding. */
  readonly bank?: BankRoles;
  /**
   * The button that gates a `ModeBinding.when` (ECS-137) — a device fact, the same way the rest of this layout
   * names which control plays which role. Omitted means the device has no modifier button, so every `when` on this
   * profile's bindings is simply never satisfied (a conditional binding configured for a device with no modifier is
   * reported as unreachable, not guessed at).
   */
  readonly modifier?: string;
  /**
   * A profile grid (ECS-138) whose cells mirror track mute state without taking over the step grid, the way the
   * step grid's own top row otherwise would -- so mute stays visible and controllable in every mode at once, not
   * only in a dedicated mode that replaces the pad grid. Built and bound the same "horizontal window" way the step
   * grid's top-row mute cells already are, so it shares the same page offset the step grid's own up/down paging
   * already moves: no separate paging control is needed for it. Omitted, track mute still needs the dedicated
   * `mixer` mode's grid takeover, exactly as before this field existed.
   */
  readonly dedicatedMuteGridId?: string;
  /**
   * A profile grid (ECS-155) whose cells are a page of a generic, ordered collection of selectable items — the
   * Push's contextual selection buttons, for instance. Built and bound the same "horizontal window, sharing the
   * step grid's own page offset" way `dedicatedMuteGridId` already is, so it pages with exactly the same up/down
   * controls, no separate paging control needed. What "selectable" means (a track, a bus, ...) is never named
   * here or anywhere in MIDI Core — only the integration layer resolving the selected index decides that. Omitted,
   * the device has no contextual selection buttons.
   */
  readonly selectionGridId?: string;
  /**
   * The button that clears the current item selection and switches the surface's generic selection state to its
   * "no item" context (ECS-155) — the Push's Master button, for instance. Omitted, the device has no such button:
   * item selection can still be set from `selectionGridId`'s own buttons, or by the application directly, but
   * never cleared from the device.
   */
  readonly selectionClear?: string;
  /**
   * A device's generic, always-available continuous controls (ECS-140), keyed by an application-defined role (e.g.
   * `"volume"`, `"send"`, `"effects"`) rather than a fixed field per role — the same "owner-defined, no invented
   * fixed set" reasoning `ControlRole`/`Selection.scope` already apply. Each value is a `PhysicalControl.id`, not
   * necessarily an `"encoder"`-kind control (a fader or knob can fill the same role). Unlike `dedicatedMuteGridId`/
   * `selectionGridId`, there's no grid here: a device's parameter encoders are typically a fixed, small set with no
   * paging of their own, one control per role, not a window onto a larger collection. A role named here with no
   * matching entry in the application's own contract (`SequencerContract.encoderParameters`) simply has no binding —
   * the same "declared on the device, but the application doesn't use it" treatment every other optional layout role
   * already gets. Omitted, the device has no such controls.
   */
  readonly encoders?: Readonly<Record<string, string>>;
  /**
   * A device's generic encoder bank: a window of relative encoders onto a page of numeric application controls
   * (e.g. the Push mk1's 8 parameter encoders, each driving one track's volume in the currently visible bank),
   * instead of `encoders`' one-encoder-one-fixed-role shape. `gridId` names a profile grid (one row, in order) the
   * same way `dedicatedMuteGridId`/`selectionGridId` already do, sharing the step grid's own page offset so no
   * separate paging control is needed. `modeButtons` are buttons that switch which named category (e.g.
   * `"volume"`) the bank currently drives — keyed the same way `bank.select` keys its buttons, by the category
   * name rather than an index, since the application decides what each category means and whether it's wired to
   * anything yet (`SequencerContract.encoderBankTemplates`). Omitted, the device has no generic encoder bank.
   */
  readonly encoderBank?: {
    readonly gridId: string;
    readonly modeButtons?: Readonly<Record<string, string>>;
    /**
     * Which `DeviceDisplayDefinition` line shows a category's values as per-segment level bars while that category
     * is live, keyed by the same category name `modeButtons` uses. Each of the grid's cells maps to the display
     * segment at the same position, so a value sits above the encoder that drives it. The display must declare
     * `segments` and `meter`. While the category isn't live, the line shows whatever `displayLines` names for it.
     */
    readonly meterLines?: Readonly<Record<string, { readonly displayId: string; readonly lineId: string }>>;
  };
  /**
   * Which `DeviceDisplayDefinition` line (ECS-137) plays each application-defined text role (e.g. `"track"`,
   * `"parameter"`) — the display counterpart to `encoders`: the device says which line a role lands on, the
   * application (`SequencerContract.displayLines`) says which control's text fills it. A role the application
   * doesn't name has no binding. Omitted, the device shows no application text.
   */
  readonly displayLines?: Readonly<Record<string, { readonly displayId: string; readonly lineId: string }>>;
}
