import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzerSoundnessCensusPath,
  extractSecurityAbstractTransferMarkers,
  validateAnalyzerSoundnessCensus,
} from './analyzer-soundness-oracle.mjs';
import { repoRoot } from './lib/repo-root.mjs';

const rootDir = repoRoot();
const generatorPath = 'packages/compiler/src/security-analyzer-soundness-oracle.ts';
const scannerPath = 'packages/compiler/src/scan/security-operation-ir.ts';
const transferPath = 'packages/compiler/src/scan/security-abstract-interpreter.ts';

describe('finite analyzer transfer/lattice census gate', () => {
  it('accepts the exact production census, markers, grammar, bounds, and exclusions', () => {
    expect(validateAnalyzerSoundnessCensus({ rootDir })).toEqual({
      findings: [],
      ok: true,
      summary: {
        effectDoors: 9,
        latticeElements: 40,
        productions: 33,
        transfers: 33,
      },
    });
  });

  it('kills a planted production transfer with no census entry', () => {
    const sources = productionSources();
    sources[scannerPath] = sources[scannerPath].replace(
      "securityAbstractTransfer('expression.identifier');",
      "securityAbstractTransfer('expression.identifier');\n    securityAbstractTransfer('expression.array-literal');",
    );
    expect(
      validateAnalyzerSoundnessCensus({ productionSources: sources, rootDir }).findings,
    ).toContain('production transfer expression.array-literal has no census row');
  });

  it('kills a deleted production marker and a census transfer deletion', () => {
    const sources = productionSources();
    sources[scannerPath] = sources[scannerPath].replace(
      "    securityAbstractTransfer('expression.identifier');\n",
      '',
    );
    expect(
      validateAnalyzerSoundnessCensus({ productionSources: sources, rootDir }).findings,
    ).toContain('census transfer expression.identifier has no production marker');

    const census = JSON.parse(
      readFileSync(path.join(rootDir, analyzerSoundnessCensusPath), 'utf8'),
    );
    census.transfers.splice(4, 1);
    expect(validateAnalyzerSoundnessCensus({ census, rootDir }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exact production transfer vocabulary'),
        expect.stringContaining('generator productions must cover'),
      ]),
    );
  });

  it('kills missing generator coverage, lattice drift, bounds drift, and dishonest exclusions', () => {
    const generatorIds = validateAnalyzerSoundnessCensus({ rootDir });
    expect(generatorIds.ok).toBe(true);
    const census = JSON.parse(
      readFileSync(path.join(rootDir, analyzerSoundnessCensusPath), 'utf8'),
    );
    const drifted = structuredClone(census);
    drifted.lattice.elements.pop();
    drifted.resourceBounds.callDepth += 1;
    drifted.language.excludedJavaScriptSemantics = [];
    drifted.language.transferWitnessExecution = 'strings only';
    drifted.language.latticeWitnessExecution = 'labels only';
    expect(validateAnalyzerSoundnessCensus({ census: drifted, rootDir }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('lattice.elements'),
        expect.stringContaining('resourceBounds'),
        expect.stringContaining('six explicit'),
        expect.stringContaining('compiled transfer programs'),
        expect.stringContaining('behavioral materialization'),
      ]),
    );

    const missingProduction = census.transfers.map((transfer) => transfer.id).slice(1);
    expect(
      validateAnalyzerSoundnessCensus({ generatorIds: missingProduction, rootDir }).findings,
    ).toContain('generator productions must cover the exact transfer census in order');

    const sources = productionSources();
    sources[generatorPath] = sources[generatorPath].replace(
      'securityAbstractInterpreterCensus.lattice.elements.map',
      'securityAbstractInterpreterCensus.lattice.elements.slice(1).map',
    );
    expect(
      validateAnalyzerSoundnessCensus({ productionSources: sources, rootDir }).findings,
    ).toContain('generator lattice witnesses must cover every declared lattice element');
  });

  it('rejects dynamic transfer markers instead of silently excluding them', () => {
    expect(
      extractSecurityAbstractTransferMarkers(
        'function example(id) { securityAbstractTransfer(id); }',
        'mutant.ts',
      ),
    ).toEqual([{ file: 'mutant.ts', id: undefined, line: 1 }]);
  });
});

function productionSources() {
  return Object.fromEntries(
    [generatorPath, scannerPath, transferPath].map((file) => [
      file,
      readFileSync(path.join(rootDir, file), 'utf8'),
    ]),
  );
}
