import { readFileSync } from 'node:fs';

import ts from 'typescript';

export const securityCoverageSchema = 'kovo-security-coverage/v1';
export const securityCarrierGrammarSchema = 'kovo-security-carrier-grammar/v1';
export const securityCarrierGrammarPurpose = 'coverage-metadata-only';
export const securityCarrierProductions = [
  { id: 'alias-or-binding', meaning: 'Authority or input moved through a local alias or binding.' },
  { id: 'budget-edge', meaning: 'A finite resource ceiling reaches its named closed verdict.' },
  {
    id: 'carrier-container',
    meaning: 'A value moves through an object, array, iterable, or parameter carrier.',
  },
  {
    id: 'encoding-variant',
    meaning:
      'Equivalent bytes, casing, separators, escaping, or URL syntax exercise one parser boundary.',
  },
  {
    id: 'exact-operation',
    meaning: 'A direct finite operation reaches its reviewed owner or closed decision.',
  },
  { id: 'helper-transfer', meaning: 'Authority or input crosses a reviewed helper-call transfer.' },
  {
    id: 'module-boundary',
    meaning:
      'Imports, exports, packages, generated modules, or realm boundaries preserve the decision.',
  },
  {
    id: 'platform-differential',
    meaning: 'Independent implementations or real platforms agree on the same decision.',
  },
  {
    id: 'positive-control',
    meaning: 'A reviewed safe construction remains accepted without widening the classifier.',
  },
  {
    id: 'root-registration',
    meaning: 'A security root is registered exactly or fails closed before execution.',
  },
  {
    id: 'runtime-floor',
    meaning: 'A runtime-owned door reconstructs, boxes, rejects, or bounds hostile data.',
  },
  {
    id: 'structural-closure',
    meaning: 'A finite registry, AST, graph, or symbol-identity relation closes the vocabulary.',
  },
];

const coverageSurfaces = [
  ['browser-operation', 'browserOperationKinds'],
  ['server-operation', 'serverOperationKinds'],
  ['root', 'rootKinds'],
  ['closed-verdict', 'closedVerdicts'],
];

/** Return the exact runtime vocabulary used by the decision-surface denominator. */
export function securityCoverageVocabulary(
  source = readFileSync(
    new URL('../packages/core/src/internal/security-operation-ir.ts', import.meta.url),
    'utf8',
  ),
) {
  return extractSecurityCoverageVocabularyFromCoreSource(source);
}

/** Build one stable cell for each finite operation, root, and closed verdict. */
export function buildSecurityCoverageCells(vocabulary = securityCoverageVocabulary()) {
  const cells = [];
  const seen = new Set();
  for (const [surface, field] of coverageSurfaces) {
    const values = vocabulary?.[field];
    if (!Array.isArray(values)) throw new TypeError(`security coverage ${field} must be an array`);
    for (const value of values) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`security coverage ${field} entries must be non-empty strings`);
      }
      const id = `${surface}:${value}`;
      if (seen.has(id)) throw new TypeError(`duplicate security coverage cell ${id}`);
      seen.add(id);
      cells.push({ id, surface, value });
    }
  }
  return cells;
}

/**
 * Independently extract the finite vocabulary from the core source declaration syntax. The gate
 * compares this parser result with the imported runtime arrays so a stale generator cannot silently
 * shrink the denominator.
 */
export function extractSecurityCoverageVocabularyFromCoreSource(source) {
  const sourceFile = ts.createSourceFile(
    'packages/core/src/internal/security-operation-ir.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return {
    browserOperationKinds: stringArrayDeclaration(sourceFile, 'browserSecurityOperationKinds'),
    closedVerdicts: stringArrayDeclaration(sourceFile, 'securitySemanticClosedReasons'),
    rootKinds: stringArrayDeclaration(sourceFile, 'securityRootKinds'),
    serverOperationKinds: stringArrayDeclaration(sourceFile, 'serverSecurityOperationKinds'),
  };
}

/** Validate one checked-in coverage manifest against the exact current denominator and corpus. */
export function evaluateSecurityCoverageManifest({ corpora, document, vocabulary }) {
  const findings = [];
  if (!isRecord(document) || document.schema !== securityCoverageSchema) {
    findings.push(`security coverage schema must be ${securityCoverageSchema}`);
  }
  let expectedCells = [];
  try {
    expectedCells = buildSecurityCoverageCells(vocabulary);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  const expectedById = new Map(expectedCells.map((cell) => [cell.id, cell]));
  const anchors = classifierAnchorMap(corpora, findings);
  const rows = Array.isArray(document?.cells) ? document.cells : [];
  if (!Array.isArray(document?.cells)) findings.push('security coverage cells must be an array');
  const seen = new Set();
  let witnessed = 0;
  let inapplicable = 0;

  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string') {
      findings.push('security coverage row must be an object with a string id');
      continue;
    }
    if (seen.has(row.id)) findings.push(`duplicate coverage cell ${row.id}`);
    seen.add(row.id);
    const expected = expectedById.get(row.id);
    if (expected === undefined) {
      findings.push(`unknown coverage cell ${row.id}`);
    } else if (row.surface !== expected.surface || row.value !== expected.value) {
      findings.push(`${row.id}: surface/value differs from the finite vocabulary`);
    }

    const witnesses = Array.isArray(row.witnesses) ? row.witnesses : [];
    if (row.disposition === 'witness') {
      witnessed += 1;
      if (witnesses.length === 0) findings.push(`${row.id}: witness coverage requires a witness`);
      if (row.reason !== null || row.review !== null) {
        findings.push(`${row.id}: witness coverage must not carry an inapplicable review`);
      }
      for (const witness of witnesses) {
        if (!isRecord(witness)) {
          findings.push(`${row.id}: witness reference must be an object`);
          continue;
        }
        const key = `${String(witness.corpus)}:${String(witness.anchor)}`;
        if (!anchors.has(key)) findings.push(`${row.id}: unknown corpus witness ${key}`);
      }
    } else if (row.disposition === 'inapplicable') {
      inapplicable += 1;
      if (witnesses.length > 0) {
        findings.push(`${row.id}: inapplicable coverage cannot carry witnesses`);
      }
      if (!substantive(row.reason) || !reviewedDecision(row.review)) {
        findings.push(
          `${row.id}: inapplicable coverage requires a substantive reason and reviewed decision`,
        );
      }
    } else {
      findings.push(`${row.id}: disposition must be witness or inapplicable`);
    }
  }

  for (const cell of expectedCells) {
    if (!seen.has(cell.id)) findings.push(`missing coverage cell ${cell.id}`);
  }

  const expectedSummary = {
    cells: expectedCells.length,
    inapplicable,
    witnessed,
  };
  if (
    isRecord(document?.summary) &&
    canonicalJson(document.summary) !== canonicalJson(expectedSummary)
  ) {
    findings.push('security coverage summary is stale');
  }
  return { findings, ok: findings.length === 0, summary: expectedSummary };
}

/** Validate the closed carrier grammar and its total mapping of historical C13 anchors. */
export function evaluateSecurityCarrierGrammar({ corpora, document }) {
  const findings = [];
  if (!isRecord(document) || document.schema !== securityCarrierGrammarSchema) {
    findings.push(`security carrier grammar schema must be ${securityCarrierGrammarSchema}`);
  }
  if (document?.purpose !== securityCarrierGrammarPurpose || document?.authority !== 'none') {
    findings.push(
      'security carrier grammar must declare coverage-metadata-only purpose and no classifier authority',
    );
  }
  const productions = Array.isArray(document?.productions) ? document.productions : [];
  if (!Array.isArray(document?.productions)) {
    findings.push('security carrier grammar productions must be an array');
  }
  const productionIds = new Set();
  for (const production of productions) {
    if (!isRecord(production) || !nonBlank(production.id) || !substantive(production.meaning)) {
      findings.push('security carrier grammar productions require id and substantive meaning');
      continue;
    }
    if (productionIds.has(production.id)) {
      findings.push(`duplicate carrier production ${production.id}`);
    }
    productionIds.add(production.id);
  }
  if (canonicalJson(productions) !== canonicalJson(securityCarrierProductions)) {
    findings.push(
      'security carrier grammar production set differs from the reviewed closed grammar',
    );
  }

  const historical = classifierAnchorMap(corpora, findings);
  const mappings = Array.isArray(document?.mappings) ? document.mappings : [];
  if (!Array.isArray(document?.mappings)) {
    findings.push('security carrier grammar mappings must be an array');
  }
  const seen = new Set();
  for (const mapping of mappings) {
    if (!isRecord(mapping)) {
      findings.push('security carrier grammar mapping must be an object');
      continue;
    }
    const key = `${String(mapping.corpus)}:${String(mapping.anchor)}`;
    if (seen.has(key)) findings.push(`duplicate historical witness mapping ${key}`);
    seen.add(key);
    if (!historical.has(key)) findings.push(`stale historical witness mapping ${key}`);
    if (!productionIds.has(mapping.production)) {
      findings.push(`${key}: unknown carrier production ${String(mapping.production)}`);
    }
    if (!substantive(mapping.reason)) {
      findings.push(`${key}: carrier mapping requires a substantive reason`);
    }
  }
  for (const key of historical.keys()) {
    if (!seen.has(key)) findings.push(`missing historical witness mapping ${key}`);
  }
  const expectedSummary = {
    historicalWitnesses: historical.size,
    productions: productionIds.size,
  };
  if (
    isRecord(document?.summary) &&
    canonicalJson(document.summary) !== canonicalJson(expectedSummary)
  ) {
    findings.push('security carrier grammar summary is stale');
  }
  return { findings, ok: findings.length === 0, summary: expectedSummary };
}

/** Build a write-ready document while preserving reviewer-owned row decisions. */
export function generatedCoverageDocument({ existing, vocabulary }) {
  const byId = new Map(
    (Array.isArray(existing?.cells) ? existing.cells : [])
      .filter((row) => isRecord(row) && typeof row.id === 'string')
      .map((row) => [row.id, row]),
  );
  const cells = buildSecurityCoverageCells(vocabulary).map((cell) => {
    const prior = byId.get(cell.id);
    return prior === undefined
      ? {
          ...cell,
          disposition: 'unclassified',
          reason: null,
          review: null,
          witnesses: [],
        }
      : {
          ...cell,
          disposition: prior.disposition,
          reason: prior.reason,
          review: prior.review,
          witnesses: prior.witnesses,
        };
  });
  return {
    schema: securityCoverageSchema,
    summary: {
      cells: cells.length,
      inapplicable: cells.filter((row) => row.disposition === 'inapplicable').length,
      witnessed: cells.filter((row) => row.disposition === 'witness').length,
    },
    cells,
  };
}

/** Build a write-ready grammar while leaving new historical anchors visibly unclassified. */
export function generatedCarrierGrammarDocument({ corpora, existing, productions }) {
  const priorByKey = new Map(
    (Array.isArray(existing?.mappings) ? existing.mappings : [])
      .filter((row) => isRecord(row))
      .map((row) => [`${String(row.corpus)}:${String(row.anchor)}`, row]),
  );
  const historical = classifierAnchorMap(corpora, []);
  const mappings = [...historical.values()].map(({ anchor, corpus }) => {
    const prior = priorByKey.get(`${corpus}:${anchor}`);
    return prior ?? { anchor, corpus, production: null, reason: null };
  });
  return {
    authority: 'none',
    purpose: securityCarrierGrammarPurpose,
    schema: securityCarrierGrammarSchema,
    summary: { historicalWitnesses: mappings.length, productions: productions.length },
    productions,
    mappings,
  };
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function classifierAnchorMap(corpora, findings) {
  const anchors = new Map();
  for (const corpus of Array.isArray(corpora) ? corpora : []) {
    if (!isRecord(corpus) || !nonBlank(corpus.id)) continue;
    for (const anchor of Array.isArray(corpus.verdictAnchors) ? corpus.verdictAnchors : []) {
      if (!isRecord(anchor) || !nonBlank(anchor.id)) continue;
      const key = `${corpus.id}:${anchor.id}`;
      if (anchors.has(key)) findings.push(`duplicate classifier anchor identity ${key}`);
      anchors.set(key, {
        anchor: anchor.id,
        corpus: corpus.id,
        snippets: Array.isArray(anchor.snippets) ? anchor.snippets : [],
      });
    }
  }
  return anchors;
}

function stringArrayDeclaration(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = unwrapExpression(declaration.initializer);
      const array =
        initializer && ts.isCallExpression(initializer)
          ? unwrapExpression(initializer.arguments[0])
          : initializer;
      if (!array || !ts.isArrayLiteralExpression(array)) {
        throw new TypeError(`${name} must be initialized from one literal array`);
      }
      return array.elements.map((element) => {
        const value = unwrapExpression(element);
        if (!value || !ts.isStringLiteral(value)) {
          throw new TypeError(`${name} must contain only string literals`);
        }
        return value.text;
      });
    }
  }
  throw new TypeError(`missing finite security declaration ${name}`);
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function reviewedDecision(value) {
  return isRecord(value) && nonBlank(value.id) && nonBlank(value.basis);
}

function substantive(value) {
  return typeof value === 'string' && value.trim().length >= 16;
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
