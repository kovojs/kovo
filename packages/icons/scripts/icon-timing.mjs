#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import { computeIconPlan } from './icon-plan.mjs';

const budgetMs = 5_000;
const startedAt = performance.now();
const plan = computeIconPlan();
const elapsedMs = performance.now() - startedAt;

if (plan.names.length !== 1_737 || plan.files.size !== 1_737) {
  throw new Error(
    `Icon plan must cover all 1737 glyphs, got ${plan.names.length} names and ${plan.files.size} files`,
  );
}
if (elapsedMs > budgetMs) {
  throw new Error(
    `All-glyph icon generation took ${elapsedMs.toFixed(1)}ms, exceeding ${budgetMs}ms`,
  );
}
process.stdout.write(
  `Icon plan generated and validated 1737 glyphs in ${elapsedMs.toFixed(1)}ms (budget ${budgetMs}ms).\n`,
);
