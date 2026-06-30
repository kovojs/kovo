import { deriveRegistryFactsFromGraph } from '../app-graph.js';
import { compileComponentModule, deriveAppGraph } from '../index.js';
import { queryShapeFactDiagnostics } from '../internal.js';

export const coverageFixtures = {
  compileComponentModule,
  deriveAppGraph,
  deriveRegistryFactsFromGraph,
  queryShapeFactDiagnostics,
} as const;
