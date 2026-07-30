/**
 * Source/AST-heavy analyzers loaded only inside the disposable static-trust subprocess.
 *
 * Keeping this module behind a dynamic import is part of the full-catalog memory invariant:
 * ts-morph and its project caches must not become resident in the later Vite/app worker.
 */
export {
  collectStaticBuildTrustFactsFromProject,
  snapshotCompilerTaskBFiniteVerdict,
} from '@kovojs/drizzle/internal/static';
export {
  buildCompilerQueryShapeFacts,
  staticDataPlaneBuildFacts,
} from '@kovojs/server/internal/data-plane-static-analysis';
