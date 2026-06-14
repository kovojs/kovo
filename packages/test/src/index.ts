export type { DiagnosticCode } from './verifier-diagnostics.js';

export { assertMutationError, propertyTest } from './assertions.js';
export type {
  MutationErrorExpectation,
  PropertyCase,
  PropertyTestOptions,
  PropertyTestResult,
} from './assertions.js';
export { createJisoTestHarness } from './harness.js';
export type {
  JisoTestContext,
  JisoTestExecOptions,
  JisoTestHarnessOptions,
  JisoTestRequest,
} from './harness.js';
export { jisoTest } from './test-case.js';
export type { JisoTestCase, JisoTestRunner } from './test-case.js';
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
// SPEC §5.2: mechanical guard that post-parse compiler phases consume typed model facts, not raw
// source strings. Asserted in tests/fw-check.node.mjs.
export { postParseSourceStringFacts, postParseSourceStringProjectFact } from './source-fixtures.js';
export type {
  PostParseSourceStringFact,
  PostParseSourceStringProjectFact,
} from './source-fixtures.js';
