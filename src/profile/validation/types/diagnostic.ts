/**
 * A single, actionable finding from validating a device profile or a
 * composition's inputs. "Actionable" per the ticket: `path` pinpoints
 * exactly where in the document the problem is (e.g.
 * `"controls[2].portId"`), and `message` says what's wrong in terms of the
 * data itself — never a guess at what the author "probably meant."
 *
 * `severity` is deliberately just `"error" | "warning"`, not a richer
 * scale: `"error"` means the document is structurally broken or makes a
 * claim that can't be resolved (a dangling reference, an unknown enum
 * value, an unresolved protocol); `"warning"` means the document is valid
 * but under-specified in a way that would leave a consumer guessing (e.g.
 * a setup step with no description). Nothing here *fixes* or
 * *infers* a correction — per the ticket, unsupported/unknown/unresolved
 * behavior is reported, not papered over with an invented setup or a
 * guessed default.
 */
export type DiagnosticSeverity = "error" | "warning";

export type ProfileDiagnosticCode =
  | "invalid-document"
  | "invalid-schema-version"
  | "unsupported-schema-version"
  | "invalid-identity"
  | "invalid-port"
  | "unknown-port-type"
  | "unknown-message-type"
  | "duplicate-port-id"
  | "invalid-control"
  | "unknown-control-kind"
  | "unknown-control-value-mode"
  | "unknown-relative-encoding"
  | "relative-control-missing-encoding"
  | "unknown-feedback-kind"
  | "invalid-rgb-prefix"
  | "duplicate-control-id"
  | "dangling-port-reference"
  | "invalid-grid"
  | "invalid-layout"
  | "duplicate-grid-id"
  | "dangling-control-reference"
  | "dangling-grid-reference"
  | "grid-cell-out-of-bounds"
  | "duplicate-grid-cell"
  | "sysex-required-no-manufacturer-id"
  | "invalid-setup"
  | "setup-step-needs-send-or-expect"
  | "setup-byte-out-of-range"
  | "setup-sysex-unterminated"
  | "setup-port-wrong-type"
  | "setup-port-not-required"
  | "setup-step-missing-description"
  | "unresolved-protocol-reference"
  | "duplicate-binding-id"
  | "invalid-mode"
  | "duplicate-mode-id"
  | "invalid-display"
  | "duplicate-display-id"
  | "duplicate-display-line-id"
  | "invalid-overrides"
  | "unsupported-overrides-schema-version"
  | "overrides-profile-mismatch"
  | "overrides-stale-profile-schema";

export interface ProfileDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: ProfileDiagnosticCode;
  /** Where in the document this finding applies, e.g. `"controls[2].portId"`. Empty string means the document as a whole. */
  readonly path: string;
  readonly message: string;
}
