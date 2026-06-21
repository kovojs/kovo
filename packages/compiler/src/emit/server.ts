// SPEC §5.2 server emitter barrel. FN6 (plans/compiler-refactoring.md) split the former
// monolithic `emit/server.ts` into concern modules behind this re-export barrel so existing
// imports (`compile.ts`, `stamps.test.ts`, `compile-component.test.ts`) stay unchanged:
//   - server-emit-shared.ts: shared low-level + mutation-form helpers used by 2+ concerns.
//   - render-equivalence.ts: the SPEC §5.2 semantic render-equivalence gate.
//   - mutation-form.ts: enhanced-mutation-form lowering/diagnostics + `mutationFormExplainFacts`.
//   - server-render.ts: server-render lowering, host-stamp writers, and `emitServerModule`.
// Behavior-neutral: a pure module move; emitted bytes and diagnostics are identical.

export {
  emitServerModule,
  serverRenderLowering,
  type EmittedServerModule,
  type ServerRenderLowering,
  type ServerRenderStampWriteFact,
} from './server-render.js';
export { semanticRenderEquivalenceCheck } from './render-equivalence.js';
export { mutationFormExplainFacts } from './mutation-form.js';
