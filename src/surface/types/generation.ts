import type { SurfaceContext } from "../../control-api/types/context.js";
import type { ControlMapping } from "../../mapping/types/mapping.js";
import type { DeviceProfile } from "../../profile/types/profile.js";
import type { ControlBinding, ModifierCondition } from "./bindings.js";

/**
 * One `ControlMapping` a generation step produced from a `ControlBinding`
 * (`docs/contracts/surface-bindings.md`, ECS-68), paired with the port
 * id(s) it binds against. A `ControlMapping`
 * (`docs/contracts/mapping.md`) carries a `MidiSource`/`MidiTarget` — an
 * address and channel — but no port id, because a mapping is defined
 * independent of any particular transport connection. A `DeviceProfile`
 * can expose more than one port (`docs/contracts/device-profile.md`'s
 * `DevicePortProfile`), so the runtime
 * (`src/surface/bindings.ts`) needs to know which connected `MidiInput`/
 * `MidiOutput` a given mapping belongs to — this is the minimum needed to
 * route it, following the same `portId`/`feedbackPortId` convention
 * (ECS-62) `PhysicalControl` already uses.
 */
export interface GeneratedBinding {
  readonly mapping: ControlMapping;
  readonly inputPortId: string;
  /** Present only when `mapping.feedback` is set. */
  readonly outputPortId?: string;
  /** Carried over from the originating `ControlBinding.when` (ECS-137), so `src/surface/bindings.ts` can gate dispatch on the mode's modifier state without re-deriving it from the binding table a second time. */
  readonly when?: ModifierCondition;
}

/**
 * The generation step `docs/control-surface-architecture.md` (ECS-64)
 * named — `(DeviceProfile, binding table) -> ControlMapping[]` — scoped
 * here to one mode's already-resolved `ControlBinding`s (a
 * `NavigationBinding` never produces a `ControlMapping` at all — see
 * `docs/contracts/surface-bindings.md`). Implementing this — reading a
 * `PhysicalControl`'s `input`/`feedback` and translating it into a
 * `MidiSource`/`MidiTarget` for the role/context each binding resolves
 * against — is ECS-72's scope, not this one's. This type is the seam
 * `src/surface/bindings.ts`'s orchestration calls through, agreed now so
 * both sides can be built independently — see
 * `docs/contracts/surface-runtime.md`.
 */
export type GenerateControlMappings = (
  profile: DeviceProfile,
  bindings: readonly ControlBinding[],
  context: SurfaceContext,
) => readonly GeneratedBinding[];
