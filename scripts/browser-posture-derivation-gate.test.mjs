// @kovo-security-classifier-corpus browser-posture
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  checkBrowserPostureDerivation,
  evaluateBrowserPostureDerivation,
  repoRoot,
} from './browser-posture-derivation-gate.mjs';

function actualSources() {
  const files = [
    'packages/core/src/internal/security-operation-ir.ts',
    'packages/compiler/src/compile.ts',
    'packages/compiler/src/browser-posture-project.ts',
    'packages/server/src/internal/data-plane-static-analysis.ts',
    'packages/server/src/internal/runtime-registry-wire.ts',
    'packages/server/src/generated-browser-posture-registry.ts',
    'packages/server/src/browser-response-posture.ts',
    'packages/server/src/csp.ts',
    'packages/server/src/document-core.ts',
    'packages/server/src/hints.ts',
    'packages/server/src/response.ts',
    'packages/cli/src/commands/build-export.ts',
  ];
  return Object.fromEntries(
    files.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')]),
  );
}

describe('check:browser-posture-derivation', () => {
  it('keeps enum-to-policy ownership exhaustive and single-sourced', () => {
    // @kovo-security-certifies C13 browser-posture-permissions-exhaustiveness
    expect(checkBrowserPostureDerivation()).toMatchObject({ ok: true });

    const missingCase = structuredClone(actualSources());
    missingCase['packages/server/src/browser-response-posture.ts'] = missingCase[
      'packages/server/src/browser-response-posture.ts'
    ].replace("    case 'browser.dialog.open':\n", '');
    expect(evaluateBrowserPostureDerivation(missingCase).findings).toContain(
      'Permissions-Policy switch is missing browser.dialog.open',
    );

    const duplicateOwner = structuredClone(actualSources());
    duplicateOwner['packages/server/src/document-core.ts'] += '\nconst duplicate = "camera=()";\n';
    expect(evaluateBrowserPostureDerivation(duplicateOwner).findings).toContain(
      'a document response site duplicates the Permissions-Policy feature list',
    );
  });

  it('binds compiler manifest through generated registry to exact response headers', () => {
    // @kovo-security-certifies C13 browser-posture-generated-wiring
    const missingWire = structuredClone(actualSources());
    missingWire['packages/server/src/internal/runtime-registry-wire.ts'] = missingWire[
      'packages/server/src/internal/runtime-registry-wire.ts'
    ].replaceAll('registerGeneratedBrowserPostureManifest', 'removedBrowserPostureRegistration');
    expect(evaluateBrowserPostureDerivation(missingWire).findings.join('\n')).toContain(
      'registerGeneratedBrowserPostureManifest',
    );

    const missingAssembler = structuredClone(actualSources());
    missingAssembler['packages/server/src/document-core.ts'] = missingAssembler[
      'packages/server/src/document-core.ts'
    ].replaceAll('browserResponsePostureHeaders', 'removedBrowserPostureHeaders');
    expect(evaluateBrowserPostureDerivation(missingAssembler).findings.join('\n')).toContain(
      'browserResponsePostureHeaders',
    );

    const missingHintWitness = structuredClone(actualSources());
    missingHintWitness['packages/server/src/document-core.ts'] = missingHintWitness[
      'packages/server/src/document-core.ts'
    ].replaceAll('assertPageHintsCrossOriginIsolationEligible', 'removedPageHintIsolationWitness');
    expect(evaluateBrowserPostureDerivation(missingHintWitness).findings.join('\n')).toContain(
      'assertPageHintsCrossOriginIsolationEligible',
    );
  });
});
