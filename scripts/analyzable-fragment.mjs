#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';
import { extractSecurityCoverageVocabularyFromCoreSource } from './security-coverage.mjs';

export const repoRoot = findRepoRoot();
export const analyzableFragmentPath = 'security/analyzable-fragment.json';
export const analyzableFragmentSchema = 'kovo-analyzable-fragment/v1';
export const analyzableFragmentSpecPath = 'spec/06-type-system.md';
export const analyzableFragmentHandArgumentPath = 'spec/06-analyzable-fragment-hand-argument.md';

const coreSecurityOperationIrPath = 'packages/core/src/internal/security-operation-ir.ts';
const compilerProvenanceRelationPath = 'packages/compiler/src/scan/security-provenance-relation.ts';
const specBlockStart = '<!-- BEGIN GENERATED ANALYZABLE FRAGMENT -->';
const specBlockEnd = '<!-- END GENERATED ANALYZABLE FRAGMENT -->';
const specInsertionAnchor =
  'The resource contract is deterministic and has no app-authored widening knob:';

const closedReasons = Object.freeze([
  'budget-call-depth',
  'budget-node-count',
  'budget-operation-count',
  'budget-summary-count',
  'helper-cycle',
  'opaque-transfer',
  'unknown-operation',
  'unsupported-authority-use',
]);

const prohibitionDefinitions = Object.freeze([
  {
    classification: 'DELIBERATE',
    closedReason: 'unsupported-authority-use',
    id: 'returning-authority',
    rationale:
      'Structured outcomes intentionally cannot transfer live framework authority to an unmodelled caller.',
    title: 'Returning authority',
  },
  {
    classification: 'DELIBERATE',
    closedReason: 'unsupported-authority-use',
    id: 'throwing-authority',
    rationale:
      'Exception propagation intentionally cannot carry authority across implicit catch and host boundaries.',
    title: 'Throwing authority',
  },
  {
    classification: 'FUNDAMENTAL',
    closedReason: 'opaque-transfer',
    id: 'opaque-container',
    rationale:
      'General JavaScript containers can hide authority behind mutation, accessors, proxies, and unknown aliases.',
    title: 'Opaque authority container',
  },
  {
    classification: 'FUNDAMENTAL',
    closedReason: 'unsupported-authority-use',
    id: 'mutating-authority-alias',
    rationale:
      'A sound and complete account of general mutable heap aliases is outside the finite local relation.',
    title: 'Mutating an authority alias or member',
  },
  {
    classification: 'FUNDAMENTAL',
    closedReason: 'opaque-transfer',
    id: 'mutable-ambiguous-join',
    rationale:
      'General path-sensitive joins can depend on mutable heap state and opaque control flow.',
    title: 'Mutable or ambiguous join',
  },
  {
    classification: 'DELIBERATE',
    closedReason: 'opaque-transfer',
    id: 'unsummarized-nested-callable',
    rationale:
      'The current summary language intentionally covers exact same-file named helpers, not captured closures.',
    title: 'Unsummarized nested callable',
  },
  {
    classification: 'DELIBERATE',
    closedReason: 'opaque-transfer',
    id: 'arguments-rest-spread-recovery',
    rationale:
      'Dynamic argument-vector recovery is intentionally excluded from exact positional authority mapping.',
    title: '`arguments`, rest, or spread recovery',
  },
  {
    classification: 'DELIBERATE',
    closedReason: 'opaque-transfer',
    id: 'call-apply-bind',
    rationale:
      'Indirect invocation is intentionally excluded so operation identity stays syntactically exact.',
    title: '`call`, `apply`, or `bind` invocation',
  },
  {
    classification: 'FUNDAMENTAL',
    closedReason: 'opaque-transfer',
    id: 'foreign-callable',
    rationale:
      'An unresolved or otherwise foreign callable has behavior unavailable to the analyzed source unit.',
    title: 'Imported, computed, aliased, reassigned, unresolved, or foreign callable',
  },
]);

const realRootCorpusFiles = Object.freeze([
  'packages/create-kovo/templates/src/app.tsx',
  'packages/create-kovo/templates/src/queries.ts',
  'packages/create-kovo/templates/src/mutations.ts',
  'examples/commerce/src/auth.ts',
  'examples/commerce/src/domain.ts',
  'examples/commerce/src/queries.ts',
  'examples/crm/src/mutations.ts',
  'examples/crm/src/queries.ts',
  'examples/reference/src/auth.ts',
  'examples/stackoverflow/src/mutations.ts',
  'examples/stackoverflow/src/queries.ts',
]);

const budgetDefinitions = Object.freeze([
  {
    bindingRoots: [],
    id: 'callDepth',
    label: 'helper edges on one path',
    limit: 16,
    reason: 'budget-call-depth',
  },
  {
    bindingRoots: [],
    id: 'nodes',
    label: 'interpreted AST nodes',
    limit: 50_000,
    reason: 'budget-node-count',
  },
  {
    bindingRoots: [],
    id: 'operations',
    label: 'finite operations',
    limit: 4_096,
    reason: 'budget-operation-count',
  },
  {
    bindingRoots: [],
    id: 'summaries',
    label: 'helper summaries per root',
    limit: 256,
    reason: 'budget-summary-count',
  },
]);

function witnessPath(id) {
  return `packages/compiler/src/fixtures/analyzable-fragment/${id}.tsx.txt`;
}

export function generatedAnalyzableFragmentDocument() {
  const prohibitions = prohibitionDefinitions.map((row) => ({
    ...row,
    witness: {
      diagnostic: 'KV449',
      file: witnessPath(row.id),
    },
  }));
  return {
    authority: 'none',
    budgetBindingMeasurement: {
      budgets: budgetDefinitions.map((budget) => ({ ...budget, bindingRoots: [] })),
      corpus: {
        files: [...realRootCorpusFiles],
        rootCount: 29,
        selection:
          'Every tracked starter/example source file that declares a shipping query, mutation, endpoint, webhook, or task root at measurement time.',
      },
      limits:
        'This is an observational regression measurement over the named repository corpus. It is not a claim that a downstream root cannot bind a budget.',
      method:
        'Compile each listed source with compileComponentModule, enumerate its emitted semantic roots, and collect roots with each exact budget-* closed trace reason.',
    },
    closedReasons: [...closedReasons],
    handArgument: {
      file: analyzableFragmentHandArgumentPath,
      kind: 'reviewed-non-mechanized-hand-argument',
    },
    prohibitions,
    purpose: 'publication-honesty-ledger',
    schema: analyzableFragmentSchema,
    sources: {
      budgets: compilerProvenanceRelationPath,
      closedReasons: coreSecurityOperationIrPath,
      specification: `${analyzableFragmentSpecPath}#66-soundness-boundary-normative`,
    },
    summary: {
      budgets: 4,
      classifications: {
        BUDGETED: 0,
        DELIBERATE: 5,
        FUNDAMENTAL: 4,
      },
      closedReasons: 8,
      prohibitions: 9,
      realRoots: 29,
    },
  };
}

function escapeTableCell(value) {
  return String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');
}

export function renderAnalyzableFragmentSpecBlock(document) {
  const tableRows = [
    ['Prohibition', 'Classification', 'KV449 closed reason', 'Witness'],
    ...document.prohibitions.map((row) => [
      escapeTableCell(row.title),
      `\`${row.classification}\``,
      `\`${row.closedReason}\``,
      `[fixture](../${row.witness.file})`,
    ]),
  ];
  const widths = tableRows[0].map((_, column) =>
    Math.max(...tableRows.map((row) => row[column].length)),
  );
  const table = tableRows.map(
    (row) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`,
  );
  table.splice(1, 0, `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`);
  return [
    specBlockStart,
    '',
    '#### Closed analyzable-fragment prohibitions (generated)',
    '',
    'This table is generated from [`security/analyzable-fragment.json`](../security/analyzable-fragment.json). The classification describes the general prohibition; each fixture is a minimal compiler-verdict witness, not an impossibility proof.',
    '',
    ...table,
    '',
    'The ledger also records the current real-root budget-binding measurement. Its [reviewed hand argument](06-analyzable-fragment-hand-argument.md) states the compositionality claim, adequacy claim, and limits.',
    '',
    specBlockEnd,
  ].join('\n');
}

export function replaceAnalyzableFragmentSpecBlock(specMarkdown, document) {
  const generated = renderAnalyzableFragmentSpecBlock(document);
  const start = specMarkdown.indexOf(specBlockStart);
  const end = specMarkdown.indexOf(specBlockEnd);
  if (start < 0 !== end < 0) {
    throw new Error('SPEC analyzable-fragment generated markers are unbalanced');
  }
  if (start >= 0) {
    return `${specMarkdown.slice(0, start)}${generated}${specMarkdown.slice(
      end + specBlockEnd.length,
    )}`;
  }
  const anchor = specMarkdown.indexOf(specInsertionAnchor);
  if (anchor < 0) throw new Error('Missing SPEC §6.6 resource-contract insertion anchor');
  return `${specMarkdown.slice(0, anchor)}${generated}\n\n${specMarkdown.slice(anchor)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function extractSemanticBudgets(source) {
  const objectMatch = source.match(
    /export const securitySemanticBudgets\s*=\s*\{(?<body>[\s\S]*?)\}\s*as const/u,
  );
  if (!objectMatch?.groups?.body) throw new Error('Cannot parse securitySemanticBudgets');
  const budgets = {};
  for (const id of ['callDepth', 'nodes', 'operations', 'summaries']) {
    const valueMatch = objectMatch.groups.body.match(
      new RegExp(`(?:^|\\n)\\s*${id}:\\s*([0-9][0-9_]*)`, 'u'),
    );
    if (!valueMatch?.[1]) throw new Error(`Cannot parse semantic budget ${id}`);
    budgets[id] = Number(valueMatch[1].replaceAll('_', ''));
  }
  return budgets;
}

function requiredHandArgumentFragments(document) {
  return [
    'Status: reviewed non-mechanized hand argument',
    'This is not a mechanized proof',
    '## Compositionality hand argument',
    '## Adequacy hand argument',
    '## Limits and non-claims',
    ...document.prohibitions.map((row) => `\`${row.id}\``),
  ];
}

export function evaluateAnalyzableFragment(input) {
  const findings = [];
  const expected = generatedAnalyzableFragmentDocument();
  if (canonicalJson(input.document) !== canonicalJson(expected)) {
    findings.push('analyzable-fragment ledger differs from its reviewed generated document');
  }
  const expectedSource = `${JSON.stringify(expected, null, 2)}\n`;
  if (input.ledgerSource !== undefined && input.ledgerSource !== expectedSource) {
    findings.push('analyzable-fragment JSON serialization is stale');
  }

  let liveClosedReasons = [];
  try {
    liveClosedReasons = extractSecurityCoverageVocabularyFromCoreSource(
      input.coreSecurityOperationIrSource,
    ).closedVerdicts;
  } catch (error) {
    findings.push(`cannot extract live closed-reason vocabulary: ${String(error)}`);
  }
  if (liveClosedReasons.length !== 8) {
    findings.push(
      `live semantic closed-reason vocabulary has ${liveClosedReasons.length}, expected 8`,
    );
  }
  if (canonicalJson(liveClosedReasons) !== canonicalJson(expected.closedReasons)) {
    findings.push('ledger closed reasons differ from the live semantic closed-reason vocabulary');
  }

  try {
    const liveBudgets = extractSemanticBudgets(input.compilerProvenanceRelationSource);
    for (const budget of expected.budgetBindingMeasurement.budgets) {
      if (liveBudgets[budget.id] !== budget.limit) {
        findings.push(
          `${budget.id} live budget ${String(liveBudgets[budget.id])} differs from ledger ${budget.limit}`,
        );
      }
    }
  } catch (error) {
    findings.push(`cannot extract live semantic budgets: ${String(error)}`);
  }

  const witnessSources = input.witnessSources instanceof Map ? input.witnessSources : new Map();
  for (const row of expected.prohibitions) {
    const source = witnessSources.get(row.witness.file);
    if (typeof source !== 'string' || source.trim().length === 0) {
      findings.push(`${row.id}: witness fixture ${row.witness.file} is missing or empty`);
    }
    if (!expected.closedReasons.includes(row.closedReason)) {
      findings.push(`${row.id}: unknown closed reason ${row.closedReason}`);
    }
  }
  const realRootSources = input.realRootSources instanceof Map ? input.realRootSources : new Map();
  for (const file of expected.budgetBindingMeasurement.corpus.files) {
    const source = realRootSources.get(file);
    if (typeof source !== 'string' || source.trim().length === 0) {
      findings.push(`real-root budget corpus source ${file} is missing or empty`);
    }
  }

  const generatedSpec = renderAnalyzableFragmentSpecBlock(input.document);
  if (!input.specMarkdown.includes(generatedSpec)) {
    findings.push('SPEC §6.6 analyzable-fragment prohibition table is stale or missing');
  }
  for (const fragment of requiredHandArgumentFragments(expected)) {
    if (!input.handArgumentMarkdown.includes(fragment)) {
      findings.push(`hand argument is missing reviewed fragment: ${fragment}`);
    }
  }

  return {
    findings: [...new Set(findings)].sort(),
    ok: findings.length === 0,
    summary: { ...expected.summary },
  };
}

export function loadAnalyzableFragmentInput({ root = repoRoot } = {}) {
  const expected = generatedAnalyzableFragmentDocument();
  const ledgerSource = readFileSync(path.join(root, analyzableFragmentPath), 'utf8');
  return {
    compilerProvenanceRelationSource: readFileSync(
      path.join(root, compilerProvenanceRelationPath),
      'utf8',
    ),
    coreSecurityOperationIrSource: readFileSync(
      path.join(root, coreSecurityOperationIrPath),
      'utf8',
    ),
    document: JSON.parse(ledgerSource),
    handArgumentMarkdown: readFileSync(path.join(root, analyzableFragmentHandArgumentPath), 'utf8'),
    ledgerSource,
    realRootSources: new Map(
      expected.budgetBindingMeasurement.corpus.files.map((file) => [
        file,
        readFileSync(path.join(root, file), 'utf8'),
      ]),
    ),
    specMarkdown: readFileSync(path.join(root, analyzableFragmentSpecPath), 'utf8'),
    witnessSources: new Map(
      expected.prohibitions.map((row) => [
        row.witness.file,
        readFileSync(path.join(root, row.witness.file), 'utf8'),
      ]),
    ),
  };
}

export function runAnalyzableFragmentGate(args = process.argv.slice(2)) {
  if (args.includes('--write')) {
    const document = generatedAnalyzableFragmentDocument();
    writeFileSync(
      path.join(repoRoot, analyzableFragmentPath),
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8',
    );
    const specPath = path.join(repoRoot, analyzableFragmentSpecPath);
    const specMarkdown = readFileSync(specPath, 'utf8');
    writeFileSync(specPath, replaceAnalyzableFragmentSpecBlock(specMarkdown, document), 'utf8');
    process.stdout.write(
      `analyzable-fragment/v1 prohibitions=${document.summary.prohibitions} budgets=${document.summary.budgets} roots=${document.summary.realRoots} wrote=1\nOK\n`,
    );
    return 0;
  }
  const result = evaluateAnalyzableFragment(loadAnalyzableFragmentInput());
  process.stdout.write(
    `analyzable-fragment/v1 prohibitions=${result.summary.prohibitions} budgets=${result.summary.budgets} roots=${result.summary.realRoots}\n`,
  );
  if (result.ok) {
    process.stdout.write('OK\n');
    return 0;
  }
  process.stderr.write(`${result.findings.map((finding) => `- ${finding}`).join('\n')}\n`);
  return 1;
}

if (isMainEntry(import.meta.url)) await runGate(runAnalyzableFragmentGate);
