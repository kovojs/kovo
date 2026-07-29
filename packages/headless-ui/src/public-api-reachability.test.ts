import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('@kovojs/headless-ui public reachability audits', () => {
  it('internalizes exactly the 38 zero-consumer runtime projections', () => {
    const audit = JSON.parse(
      readFileSync(join(packageRoot, 'runtime-helper-audit.json'), 'utf8'),
    ) as {
      auditedCount: number;
      entries: {
        decision: string;
        evidence: {
          declarationTag: string;
          generatedAbiReference: boolean;
          publicNamedImports: Record<string, number>;
        };
        specifier: string;
        symbol: string;
      }[];
    };

    expect(audit.auditedCount).toBe(38);
    expect(audit.entries).toHaveLength(38);
    expect(audit.entries.filter((entry) => entry.decision === 'generated-only')).toHaveLength(9);
    for (const entry of audit.entries) {
      expect(Object.values(entry.evidence.publicNamedImports), entry.symbol).toEqual([0, 0, 0, 0]);
      expect(entry.evidence.declarationTag, entry.symbol).toBe(
        entry.decision === 'generated-only' ? '@generated' : '@internal',
      );
      expect(entry.evidence.generatedAbiReference, entry.symbol).toBe(
        entry.decision === 'generated-only',
      );
      const subpath = entry.specifier.slice('@kovojs/headless-ui/'.length);
      const facade = readFileSync(join(packageRoot, 'src', 'public', `${subpath}.ts`), 'utf8');
      expect(facade, entry.symbol).not.toMatch(
        new RegExp(`(?:^|[, {])${entry.symbol}(?:$|[, }])`, 'm'),
      );
    }
  });

  it('proves transition carriers are unreachable from public and generated facades', () => {
    const audit = JSON.parse(
      readFileSync(join(packageRoot, 'transition-abi-audit.json'), 'utf8'),
    ) as {
      generatedFacadeReachable: string[];
      publicReachable: string[];
      sourceDeclarationCount: number;
    };

    expect(audit.sourceDeclarationCount).toBe(225);
    expect(audit.publicReachable).toEqual([]);
    expect(audit.generatedFacadeReachable).toEqual([]);
  });
});
