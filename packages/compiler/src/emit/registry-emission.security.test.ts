import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { emitRegistryModule } from './registry.js';

describe('registry structural source emission (SPEC §5.2)', () => {
  it('confines a hostile registry identity to one parse-tree string leaf', () => {
    const hostile = "safe'; interface RegistryOwned { value: true } //";
    const source = emitRegistryModule({
      clientFileName: 'safe.client.js',
      componentName: 'SafeComponent',
      cssAssets: [],
      domComponentName: 'safe-component',
      fragmentTargetFacts: [],
      handlers: [],
      liveTargetFacts: [],
      platformSubstitutions: [],
      queryUpdatePlans: [],
      registryComponentName: 'components/safe/safe-component',
      viewTransitions: [{ name: hostile }],
    });
    const parsed = ts.createSourceFile(
      'generated/safe.registry.d.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const hostileLeaves: ts.StringLiteral[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && node.text === hostile) hostileLeaves.push(node);
      ts.forEachChild(node, visit);
    };
    visit(parsed);

    expect(parsed.parseDiagnostics).toEqual([]);
    expect(hostileLeaves).toHaveLength(1);
    expect(hostileLeaves[0]?.getChildCount(parsed)).toBe(0);
  });
});
