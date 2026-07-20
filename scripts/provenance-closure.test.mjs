import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildProvenanceRelationArtifact,
  defaultProvenanceRelationPath,
  extractServerExpressionProvenanceArms,
  validateProvenanceRelationArtifact,
} from './provenance-closure.mjs';
import { repoRoot } from './lib/repo-root.mjs';

const scannerPath = 'packages/compiler/src/scan/security-operation-ir.ts';

describe('provenance closure artifact gate', () => {
  it('accepts the committed exact finite relation and reachability artifact', () => {
    const document = JSON.parse(
      readFileSync(`${repoRoot()}/${defaultProvenanceRelationPath}`, 'utf8'),
    );
    expect(validateProvenanceRelationArtifact(document)).toMatchObject({
      findings: [],
      ok: true,
      summary: {
        browserStates: 20,
        closedReasons: 8,
        memberClasses: 57,
        relationPairs: 2_451,
        serverStates: 43,
      },
    });
  });

  it('kills a mutated relation cell in the committed artifact', () => {
    const mutant = structuredClone(buildProvenanceRelationArtifact());
    mutant.serverMemberRelation.context['literal:fetch'] = 'local';
    expect(validateProvenanceRelationArtifact(mutant).findings).toEqual([
      `${defaultProvenanceRelationPath}: stale or mutated; run pnpm run generate:provenance-relation`,
    ]);
  });

  it('extracts the complete arm census from the scanner AST', () => {
    const source = readFileSync(`${repoRoot()}/${scannerPath}`, 'utf8');
    expect(extractServerExpressionProvenanceArms(source)).toEqual([
      'identifier-environment-lookup',
      'object-literal-implicit-protocol-shape',
      'new-expression',
      'call-expression',
      'binary-expression',
      'conditional-expression',
      'static-member',
      'foreign-executable-containment',
      'governed-data-containment',
      'unsafe-wire-data-containment',
      'authority-containment',
    ]);
  });

  it('kills an uncensused no-call expression-arm mutant', () => {
    const source = readFileSync(`${repoRoot()}/${scannerPath}`, 'utf8');
    const mutant = source.replace(
      '  if (ts.isNewExpression(current)) {',
      "  if (current.kind === ts.SyntaxKind.ArrayLiteralExpression) return 'local';\n  if (ts.isNewExpression(current)) {",
    );
    expect(extractServerExpressionProvenanceArms(mutant)).toContainEqual(
      expect.stringMatching(/^unclassified:BinaryExpression:/),
    );
  });

  it('kills uncensused else-if and top-level switch mutants', () => {
    const source = readFileSync(`${repoRoot()}/${scannerPath}`, 'utf8');
    const elseIfMutant = source.replace(
      '  if (ts.isNewExpression(current)) {',
      "  if (ts.isArrayLiteralExpression(current)) return 'local';\n  else if (ts.isNewExpression(current)) {",
    );
    expect(extractServerExpressionProvenanceArms(elseIfMutant)).toContain(
      'unclassified:isArrayLiteralExpression:ts.isArrayLiteralExpression(current)',
    );

    const switchMutant = source.replace(
      '  if (ts.isNewExpression(current)) {',
      '  switch (current.kind) { default: break; }\n  if (ts.isNewExpression(current)) {',
    );
    expect(extractServerExpressionProvenanceArms(switchMutant)).toContain(
      'unclassified-statement:SwitchStatement',
    );
  });

  it('recognizes only the exact registered final containment payload', () => {
    const source = readFileSync(`${repoRoot()}/${scannerPath}`, 'utf8');
    const mutant = source.replace(
      "'fallthrough-contained-local',\n    expressionContainsServerAuthority(current, aliases) ? 'unknown-authority' : 'local',",
      "'unreviewed-local-grant',\n    expressionContainsServerAuthority(current, aliases) ? 'unknown-authority' : 'local',",
    );
    expect(mutant).not.toBe(source);
    expect(extractServerExpressionProvenanceArms(mutant)).toContain(
      'unclassified-return:CallExpression',
    );
  });
});
