import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(srcDir);
const repoRoot = dirname(dirname(pkgRoot));

describe('primitive/component manifest generation', () => {
  it('round-trips UI, headless, and gallery generated artifacts', () => {
    const output = execFileSync(process.execPath, [join(pkgRoot, 'scripts/build-registry.mjs')], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(output).toContain('ui/headless/gallery manifest artifacts are up to date');
  });
});
