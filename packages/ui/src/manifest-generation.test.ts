import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  GENERATED_ARTIFACT_GENERATORS,
  generatedArtifactGeneratorCheckCommand,
} from '../../../scripts/generated-artifacts.mjs';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(srcDir);
const repoRoot = dirname(dirname(pkgRoot));

describe('primitive/component manifest generation', () => {
  it('round-trips UI, headless, and gallery generated artifacts', () => {
    const [command, ...args] = generatedArtifactGeneratorCheckCommand(
      GENERATED_ARTIFACT_GENERATORS.uiRegistry,
    );
    const output = execFileSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(output).toContain('ui/headless/gallery manifest artifacts are up to date');
  });
});
