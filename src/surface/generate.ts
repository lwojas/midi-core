import type { SurfaceContext } from "../control-api/types/context.js";
import type { MidiAddress, MidiSource, MidiTarget } from "../mapping/types/address.js";
import type { ControlMapping } from "../mapping/types/mapping.js";
import type { ControlSurfaceAddress, PhysicalControl } from "../profile/types/control.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import { resolveControlId, type ControlBinding } from "./types/bindings.js";
import type { GeneratedBinding } from "./types/generation.js";

/**
 * Translates a profile's `ControlSurfaceAddress` into the mapping layer's
 * narrower `MidiAddress`. Only `control-change`/`note`/`pitch-bend` have
 * a path into a `ControlMapping` at all — `program-change`/
 * `channel-pressure`/`poly-pressure` are the "known, accepted limitation"
 * `docs/control-surface-architecture.md` already named. A control
 * addressed with one of those three returns `undefined` here rather than
 * an invented mapping or a parallel address-translation workaround;
 * widening `MidiAddress` itself, if it ever happens, stays
 * `docs/contracts/mapping.md`'s decision to make, not this function's.
 */
function toMidiAddress(address: ControlSurfaceAddress): MidiAddress | undefined {
  switch (address.type) {
    case "control-change":
      return { type: "control-change", controller: address.controller };
    case "note":
      return { type: "note", note: address.note };
    case "pitch-bend":
      return { type: "pitch-bend" };
    default:
      return undefined;
  }
}

/**
 * A control with no `input` at all (a pure indicator, feedback-only)
 * can't produce a `MidiSource` — and `ControlMapping.source` is required
 * (`docs/contracts/mapping.md`), so there's no mapping shape for
 * "feedback-only, no source" to fall back to. Unresolved, since no
 * concrete profile has needed one yet; a future `ControlMapping` variant
 * for that case is `mapping.md`'s decision, not invented here.
 */
function toMidiSource(control: PhysicalControl): MidiSource | undefined {
  if (!control.input) return undefined;
  const address = toMidiAddress(control.input.address);
  if (!address) return undefined;
  return { address, channel: control.input.channel ?? "any" };
}

/**
 * `MidiTarget.channel` must be concrete (`docs/contracts/mapping.md`
 * gives feedback no `"any"` option — there's no such thing as sending to
 * any channel). A profile's `feedback.address.channel` can be
 * unresolved (ECS-62's partially-known-evidence case); when it is, this
 * returns `undefined` and the resulting mapping is simply input-only,
 * rather than guessing a channel to make feedback "work."
 */
function toMidiTarget(control: PhysicalControl): MidiTarget | undefined {
  if (!control.feedback) return undefined;
  const channel = control.feedback.address.channel;
  if (channel === undefined) return undefined;
  const address = toMidiAddress(control.feedback.address.address);
  if (!address) return undefined;
  return { address, channel };
}

/**
 * The generation step `docs/control-surface-architecture.md` (ECS-64)
 * named and `docs/contracts/surface-bindings.md`/`surface-runtime.md`
 * (ECS-68/69) left for this ticket to implement, matching the
 * `GenerateControlMappings` seam exactly: for each `ControlBinding`,
 * finds the `PhysicalControl` it names, translates that control's
 * declared `input`/`feedback` into a `MidiSource`/`MidiTarget`, resolves
 * the `ControlId` its role means right now via `resolveControlId()`
 * (ECS-68), and pairs the resulting `ControlMapping` with the port id(s)
 * it binds against (`GeneratedBinding`, ECS-69) — reusing
 * `ControlMapping`/`MidiSource`/`MidiTarget` exactly as
 * `docs/contracts/mapping.md` already defines them, per this ticket's
 * "evolve existing bidirectional mapping functionality... rather than
 * creating a second competing mapping system."
 *
 * A binding this can't fully resolve — a dangling `physicalControlId`, a
 * control with no usable `input`, a role with nothing currently
 * selected — produces no entry at all, rather than a partial or invented
 * one. The same "report, don't guess" stance every resolution function
 * in this project already takes (`resolveIncomingValue`,
 * `buildFeedbackMessage`, `resolveControlId`).
 *
 * No note/CC numbers are authored here — every address comes from
 * `PhysicalControl.input`/`feedback`, exactly the "express bindings
 * without hardcoded device note layouts" the ticket requires. No
 * `Control`/`ControlRegistry`/`MidiInput`/`MidiOutput` is touched either;
 * turning a `GeneratedBinding` into a live, bound mapping is
 * `src/surface/bindings.ts`'s job (ECS-69), not this function's.
 */
export function generateControlMappings(
  profile: DeviceProfile,
  bindings: readonly ControlBinding[],
  context: SurfaceContext,
): readonly GeneratedBinding[] {
  const generated: GeneratedBinding[] = [];

  for (const binding of bindings) {
    const control = profile.controls.find((candidate) => candidate.id === binding.physicalControlId);
    if (!control) continue;

    const source = toMidiSource(control);
    if (!source) continue;

    const controlId = resolveControlId(binding.resolve, context);
    if (controlId === undefined) continue;

    const target = toMidiTarget(control);

    const mapping: ControlMapping = {
      id: binding.physicalControlId,
      control: controlId,
      source,
      ...(target ? { feedback: target } : {}),
    };

    generated.push({
      mapping,
      inputPortId: control.portId,
      ...(target ? { outputPortId: control.feedbackPortId ?? control.portId } : {}),
    });
  }

  return generated;
}
