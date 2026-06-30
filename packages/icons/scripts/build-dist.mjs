#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { computeIconPlan, pkgDir } from './icon-plan.mjs';

const plan = computeIconPlan();
execFileSync('pnpm', ['exec', 'vp', 'pack', ...plan.packEntries, '--dts'], {
  cwd: pkgDir,
  stdio: 'inherit',
});
