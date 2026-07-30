/**
 * Confidentiality and trust-boundary values for app-authored server code.
 *
 * Runtime validation and compiler provenance remain the enforcement boundary;
 * these types are author-time guardrails (SPEC §2 and §6.6).
 */
export {
  DeclassifyPolicy,
  declareOffWire,
  isRedacted,
  isSecret,
  isUntrusted,
  publishToClient,
  redacted,
  revealRedacted,
  revealSecret,
  revealUntrusted,
  secret,
  trustedReveal,
  untrusted,
} from './secret.js';
export type {
  Redacted,
  RedactedValue,
  Secret,
  SecretValue,
  Untrusted,
  UntrustedValue,
} from './secret.js';
