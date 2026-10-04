import type { Action, ActionDef } from "./types/action.js";

/**
 * The generic `Action` implementation: `invoke()` just calls the supplied
 * callback. No state, no `onChange` — matching
 * `docs/contracts/control-api.md`'s `Action` exactly, which exists
 * precisely for commands (transport play/stop, "trigger step") that have
 * an effect but nothing to read back.
 */
export function createAction(def: ActionDef, onInvoke: () => void): Action {
  return { def, invoke: onInvoke };
}
