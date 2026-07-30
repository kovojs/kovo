import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { validateApiDecisionLedger } from './api-decision-ledger.mjs';
import { buildPublicApiInventory } from './public-api-inventory.mjs';
import { repoRoot } from './public-packages.mjs';

function clone(value) {
  return structuredClone(value);
}

describe('public API decision ledger', () => {
  let inventory;
  let ledger;

  beforeAll(() => {
    inventory = buildPublicApiInventory({ repoRoot });
    ledger = JSON.parse(readFileSync(path.join(repoRoot, 'api-surface-decisions.json'), 'utf8'));
  }, 60_000);

  it('covers the complete manifest-declared public surface', () => {
    const result = validateApiDecisionLedger({ inventory, ledger, repoRoot });
    expect(result.findings).toEqual([]);
    expect(result.report.declarations).toBe(inventory.exportedDeclarations.length);
    expect(result.report.subpaths).toBe(inventory.manifestPublicSubpaths.length);
  });

  it('proves the Server root cut, internalization, and runtime bootstrap task', () => {
    const serverRoot = inventory.exportedDeclarations.filter(
      (declaration) => declaration.package === '@kovojs/server' && declaration.subpath === '.',
    );
    expect(serverRoot).toHaveLength(116);
    expect(serverRoot.length).toBeLessThanOrEqual(
      ledger.healthTargets.rootDeclarations['@kovojs/server'],
    );
    for (const declaration of serverRoot) {
      expect(
        ledger.symbols.find((row) => row.id === `${declaration.specifier}#${declaration.symbol}`),
      ).toMatchObject({
        canonicalHome: '@kovojs/server',
        decision: 'keep',
        state: 'public',
      });
    }

    const serverPublicSymbols = new Set(
      inventory.exportedDeclarations
        .filter((declaration) => declaration.package === '@kovojs/server')
        .map((declaration) => declaration.symbol),
    );
    const retiredCarriers = ledger.symbols.filter(
      (row) =>
        row.package === '@kovojs/server' &&
        row.state === 'removed' &&
        (row.decision === 'internalize' || row.decision === 'remove'),
    );
    expect(retiredCarriers.length).toBeGreaterThan(0);
    expect(retiredCarriers.filter((row) => serverPublicSymbols.has(row.symbol))).toEqual([]);

    expect(
      inventory.manifestPublicSubpaths.find(
        (unit) => unit.specifier === '@kovojs/server/runtime-bootstrap',
      ),
    ).toMatchObject({
      source: 'packages/server/src/runtime-bootstrap.ts',
      subpath: './runtime-bootstrap',
    });
    expect(
      ledger.subpaths.find((row) => row.specifier === '@kovojs/server/runtime-bootstrap'),
    ).toMatchObject({
      owner: 'server-runtime',
      state: 'public',
      story: 'server-runtime-bootstrap',
    });
  });

  it('fails when a non-generated declaration loses its symbol-level decision', () => {
    const candidate = ledger.symbols.find((row) => row.state === 'public');
    const mutated = clone(ledger);
    mutated.symbols = mutated.symbols.filter((row) => row.id !== candidate.id);

    const result = validateApiDecisionLedger({ inventory, ledger: mutated, repoRoot });
    expect(result.findings).toContain(
      `${candidate.id}: expected one exact decision row or reviewed generated-family rule, found 0`,
    );
  });

  it('limits wildcard decisions to the reviewed UI and icon generators', () => {
    const mutated = clone(ledger);
    mutated.generatedFamilies[0].package = '@kovojs/core';

    const result = validateApiDecisionLedger({ inventory, ledger: mutated, repoRoot });
    expect(result.findings).toContain(
      'generatedFamilies[0]: family rules are limited to reviewed UI/icon generators',
    );
  });

  it('rejects publicizing an internal helper as a recursive-leak workaround', () => {
    const declaration = {
      ...clone(inventory.exportedDeclarations[0]),
      package: '@kovojs/core',
      subpath: '.',
      specifier: '@kovojs/core',
      symbol: 'PreviouslyInternalLeak',
      kind: 'type',
    };
    const mutatedInventory = clone(inventory);
    mutatedInventory.exportedDeclarations.push(declaration);
    const mutated = clone(ledger);
    mutated.symbols.push({
      id: '@kovojs/core#PreviouslyInternalLeak',
      package: '@kovojs/core',
      specifier: '@kovojs/core',
      symbol: 'PreviouslyInternalLeak',
      state: 'public',
      decision: 'keep',
      canonicalHome: '@kovojs/core',
      story: mutated.symbols[0].story,
      evidence: mutated.symbols[0].evidence,
    });

    const result = validateApiDecisionLedger({
      inventory: mutatedInventory,
      ledger: mutated,
      repoRoot,
    });
    expect(result.findings).toContain(
      '@kovojs/core#PreviouslyInternalLeak: a declaration outside the frozen baseline needs introduced evidence',
    );
  });

  it('requires explicit reviewed evidence for declaration growth', () => {
    const row = ledger.symbols.find(
      (candidate) =>
        candidate.state === 'public' &&
        candidate.decision === 'keep' &&
        ledger.baseline.declarations.includes(candidate.id),
    );
    const mutated = clone(ledger);
    mutated.baseline.declarations = mutated.baseline.declarations.filter((id) => id !== row.id);
    const mutatedRow = mutated.symbols.find((candidate) => candidate.id === row.id);
    mutatedRow.decision = 'internalize';
    mutatedRow.canonicalHome = `internal:${mutatedRow.package}`;

    const result = validateApiDecisionLedger({ inventory, ledger: mutated, repoRoot });
    expect(result.findings).toContain(
      `${row.id}: declaration growth requires an exact public keep row`,
    );
  });

  it('rejects duplicate public homes for one package symbol', () => {
    const declaration = inventory.exportedDeclarations.find(
      (candidate) =>
        candidate.package === '@kovojs/server' &&
        candidate.specifier === '@kovojs/server' &&
        candidate.symbol === 'defineKovo',
    );
    const mutatedInventory = clone(inventory);
    mutatedInventory.exportedDeclarations.push({
      ...clone(declaration),
      subpath: './command',
      specifier: '@kovojs/server/command',
    });

    const result = validateApiDecisionLedger({
      inventory: mutatedInventory,
      ledger,
      repoRoot,
    });
    expect(result.findings).toContain(
      '@kovojs/server#defineKovo: public declaration has multiple homes: @kovojs/server, @kovojs/server/command',
    );
  });

  it.each([
    ['internalize', 'isKovoApp', '@kovojs/server/command'],
    ['remove', 'committedSecretWaiver', '@kovojs/server/security'],
  ])(
    'prevents a %s decision from returning through another public home',
    (decision, symbol, specifier) => {
      const sourceDeclaration = inventory.exportedDeclarations.find(
        (candidate) => candidate.package === '@kovojs/server' && candidate.specifier === specifier,
      );
      const mutatedInventory = clone(inventory);
      mutatedInventory.exportedDeclarations.push({
        ...clone(sourceDeclaration),
        symbol,
      });

      const result = validateApiDecisionLedger({
        inventory: mutatedInventory,
        ledger,
        repoRoot,
      });
      expect(result.findings).toContain(
        `@kovojs/server#${symbol}: ${decision} symbol remains public at ${specifier}`,
      );
    },
  );

  it('requires a documented task row for every new subpath', () => {
    const row = ledger.subpaths[0];
    const mutated = clone(ledger);
    mutated.baseline.subpaths = mutated.baseline.subpaths.filter(
      (specifier) => specifier !== row.specifier,
    );

    const result = validateApiDecisionLedger({ inventory, ledger: mutated, repoRoot });
    expect(result.findings).toContain(
      `${row.specifier}: new public subpath requires an exact reviewed task row`,
    );
  });

  it('binds each row to its story evidence and keeps root health targets visible', () => {
    const mutated = clone(ledger);
    mutated.symbols[0].evidence =
      mutated.symbols[0].evidence === 'core-authoring-contract'
        ? 'browser-contract'
        : 'core-authoring-contract';
    delete mutated.healthTargets.rootDeclarations['@kovojs/core'];

    const result = validateApiDecisionLedger({ inventory, ledger: mutated, repoRoot });
    expect(
      result.findings.some((finding) =>
        finding.includes('.evidence must match the selected story'),
      ),
    ).toBe(true);
    expect(result.findings).toContain(
      'healthTargets.rootDeclarations.@kovojs/core must be a positive integer',
    );
  });

  it('enforces root declaration health targets as upper bounds', () => {
    const mutated = clone(ledger);
    const serverRootCount = inventory.exportedDeclarations.filter(
      (declaration) => declaration.package === '@kovojs/server' && declaration.subpath === '.',
    ).length;
    mutated.healthTargets.rootDeclarations['@kovojs/server'] = serverRootCount - 1;

    const result = validateApiDecisionLedger({ inventory, ledger: mutated, repoRoot });
    expect(result.findings).toContain(
      `healthTargets.rootDeclarations.@kovojs/server=${serverRootCount - 1} is exceeded by ${serverRootCount} declarations`,
    );
  });
});
