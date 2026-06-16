export type { DiagnosticCode } from './verifier-diagnostics.js';

export { assertMutationError, propertyTest } from './assertions.js';
export type {
  MutationErrorExpectation,
  PropertyCase,
  PropertyTestOptions,
  PropertyTestResult,
} from './assertions.js';
export { createKovoTestHarness } from './harness.js';
export type {
  KovoTestContext,
  KovoTestExecOptions,
  KovoTestHarnessOptions,
  KovoTestRequest,
} from './harness.js';
export { kovoTest } from './test-case.js';
export type { KovoTestCase, KovoTestRunner } from './test-case.js';
export { createPgliteTestDb } from './pglite.js';
export type { PgliteTestDb } from './pglite.js';
export type { PageAssertion } from './page.js';
export { createDbVerifier } from './verifier.js';
export type {
  DbObservationOptions,
  DbVerificationConfig,
  DbVerificationDiagnostic,
  DbVerifier,
  ObservedDbOperation,
} from './verifier.js';
// SPEC §5.2: the post-parse source-string guard fixtures (postParseSourceStringFacts /
// postParseSourceStringProjectFact, asserted in tests/kovo-check.node.mjs) are conformance
// fixtures and now live in the private @kovojs/conformance-fixtures package (api-cleanup R5),
// so they are no longer re-exported from the public @kovojs/test barrel.
