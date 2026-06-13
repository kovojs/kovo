import { cssScopeRules } from './source-fixtures.ts';

export type MarkdownFields = Map<string, string>;
export type MarkdownTableRow = Record<string, string>;

export interface MarkdownBoldSectionHeading {
  number: string;
  title: string;
}

export interface NormativeDocsCssManifest {
  stylesheets: readonly {
    fragmentTargets?: readonly string[];
    href: string;
  }[];
}

export interface NormativeDocsCompileResult {
  files: readonly { kind: string; source: string }[];
  handlerExports: readonly string[];
}

export interface NormativeDocsGateFact {
  compilerRuleItemsMatchTitles: boolean;
  compilerRuleTitles: string[];
  cssContractHeadings: MarkdownBoldSectionHeading[];
  cssScopeRules: {
    limit: string;
    raw: string;
    scope: string;
  }[];
  cssStylesheet: {
    fragmentTargets: readonly string[] | undefined;
    href: string | undefined;
  };
  hardRuleTitlesCovered: string[];
  renderEquivalenceAsserted: boolean;
  constitutionRuleTitles: string[];
  constitutionTableNumbers: string[];
  constitutionTableRuleTitles: string[];
  handlerExports: readonly string[];
}

export interface AcceptanceLedgerRunFact {
  command: string;
  commit: string;
  result: string;
}

export interface V1AcceptanceLedgerGateFact {
  auditRows: MarkdownTableRow[];
  auditStatuses: Record<string, string>;
  cleanCheckoutStatuses: string[];
  externalAuditPendingCount: number;
  gateCriteria: string[];
  gateCriteriaMatchSpec: boolean;
  gateEvidenceArtifacts: Record<string, string | undefined>;
  gateStatuses: Record<string, string | undefined>;
  localAcceptanceAuditPending: boolean;
  localAcceptanceAuditRunCount: number;
  passedAcceptanceRunCount: number;
  pendingFreezeRunCount: number;
  runFacts: AcceptanceLedgerRunFact[];
  specGateCriteria: string[];
}

export function normalizeMarkdownCell(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function markdownSection(source: string, heading: string): string {
  const lines = source.split('\n');
  const headingLineIndex = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match && normalizeMarkdownCell(match[2] ?? '') === heading;
  });
  if (headingLineIndex === -1) {
    throw new Error(`Markdown contains heading ${heading}`);
  }

  const headingLine = lines[headingLineIndex] ?? '';
  const headingMatch = /^(#{1,6})/.exec(headingLine);
  const headingMarker = headingMatch?.[1];
  if (!headingMarker) {
    throw new Error(`Markdown heading is structured: ${headingLine}`);
  }
  const level = headingMarker.length;
  const endIndex = lines.findIndex((line, index) => {
    if (index <= headingLineIndex) return false;
    const match = /^(#{1,6})\s+/.exec(line);
    return match && match[1]!.length <= level;
  });

  return lines.slice(headingLineIndex + 1, endIndex === -1 ? undefined : endIndex).join('\n');
}

export function markdownNumberedListItems(source: string): string[] {
  return source
    .split('\n')
    .map((line) => /^\s*\d+\.\s+(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => normalizeMarkdownCell(match[1] ?? ''));
}

export function markdownNumberedListTitles(source: string): string[] {
  return markdownNumberedListItems(source).map((item) =>
    normalizeMarkdownCell(item.split('.')[0]!),
  );
}

export function markdownCanonicalSpecRuleTitle(title: string): string {
  return normalizeMarkdownCell(title)
    .replace('Local code must not require global knowledge', 'No global knowledge at local sites')
    .replace('One-to-one file mapping', '1:1 file mapping')
    .replace('Platform behavior emission', 'Platform-behavior emission');
}

export function markdownCanonicalSpecRuleTitles(titles: readonly string[]): string[] {
  return titles.map(markdownCanonicalSpecRuleTitle);
}

export function markdownBoldSectionHeadings(source: string): MarkdownBoldSectionHeading[] {
  return source
    .split('\n')
    .map((line) => /^\s*\*\*(\d+(?:\.\d+)*)\s+(.+?)[.:]\*\*(?:\s+.*)?$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      number: match[1] ?? '',
      title: normalizeMarkdownCell(match[2] ?? ''),
    }));
}

export function markdownLeadingTitle(value: string): string {
  return normalizeMarkdownCell(value.replaceAll('**', '').split('.')[0] ?? '');
}

export function markdownFields(source: string): MarkdownFields {
  const fields: MarkdownFields = new Map();
  let currentField: string | undefined;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    const match = /^([A-Z][A-Za-z ]+):\s+(.+)$/.exec(trimmed);
    if (match) {
      const fieldName = match[1] ?? '';
      currentField = fieldName;
      fields.set(currentField, normalizeMarkdownCell(match[2] ?? ''));
      continue;
    }

    if (
      currentField &&
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('```')
    ) {
      fields.set(currentField, normalizeMarkdownCell(`${fields.get(currentField)} ${trimmed}`));
      continue;
    }

    currentField = undefined;
  }

  return fields;
}

export function markdownTableRows(source: string): MarkdownTableRow[] {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  if (lines.length < 2) {
    throw new Error('Markdown section contains a table');
  }

  const header = lines[0]!
    .slice(1, -1)
    .split('|')
    .map((cell) => normalizeMarkdownCell(cell));

  return lines.slice(2).map((line) => {
    const values = line
      .slice(1, -1)
      .split('|')
      .map((cell) => normalizeMarkdownCell(cell));
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
  });
}

function markdownRequiredTableCell(row: MarkdownTableRow, name: string): string {
  const value = row[name];
  if (value === undefined) {
    throw new Error(`Markdown table row contains ${name}`);
  }
  return value;
}

function generatedCssScopeRuleFacts(
  files: readonly { kind: string; source: string }[],
): NormativeDocsGateFact['cssScopeRules'] {
  const cssFiles = files.filter((file) => file.kind === 'css');
  if (cssFiles.length !== 1) {
    throw new Error(`Expected one generated CSS artifact; found ${cssFiles.length}`);
  }

  return cssScopeRules(cssFiles[0]!.source);
}

export function normativeDocsGateFact<T extends NormativeDocsCompileResult>(options: {
  assertRenderEquivalence: (result: T) => void;
  collectCssAssetManifest: (result: T, options: { baseHref: string }) => NormativeDocsCssManifest;
  compileComponentModule: (input: { fileName: string; source: string }) => T;
  compilerRules: string;
  constitution: string;
  spec: string;
}): NormativeDocsGateFact {
  const constitutionRows = markdownTableRows(
    markdownSection(options.spec, '2. The Constitution (Design Tests)'),
  );
  const specHardRuleTitles = markdownNumberedListTitles(
    markdownSection(options.spec, '5.2 Hard rules (normative)'),
  );
  const compilerRuleTitles = markdownCanonicalSpecRuleTitles(
    markdownNumberedListTitles(options.compilerRules),
  );
  const compilerRuleItems = markdownNumberedListItems(options.compilerRules);
  const cssContractHeadings = markdownBoldSectionHeadings(
    markdownSection(options.spec, '13. Open Design Areas (named, not hand-waved)'),
  );
  const behaviorFixture = options.compileComponentModule({
    fileName: 'components/docs/doc-card.tsx',
    source: `
import { component } from '@jiso/core';

function choose() {}

export const DocCard = component('doc-card', {
  fragmentTarget: true,
  css: \`
    .title { color: teal; }
  \`,
  render: () => <doc-card><button onClick={choose}>Choose</button><span class="title">Ready</span></doc-card>,
});
`,
  });
  const cssManifest = options.collectCssAssetManifest(behaviorFixture, { baseHref: '/_jiso/' });
  options.assertRenderEquivalence(behaviorFixture);

  return {
    compilerRuleItemsMatchTitles: compilerRuleItems.length === compilerRuleTitles.length,
    compilerRuleTitles,
    constitutionRuleTitles: markdownNumberedListTitles(options.constitution),
    constitutionTableRuleTitles: constitutionRows.map((row) =>
      markdownCanonicalSpecRuleTitle(markdownLeadingTitle(row.Test ?? '')),
    ),
    cssContractHeadings,
    cssScopeRules: generatedCssScopeRuleFacts(behaviorFixture.files),
    cssStylesheet: {
      fragmentTargets: cssManifest.stylesheets[0]?.fragmentTargets,
      href: cssManifest.stylesheets[0]?.href,
    },
    handlerExports: behaviorFixture.handlerExports,
    hardRuleTitlesCovered: markdownCanonicalSpecRuleTitles(specHardRuleTitles).filter(
      (title) => title !== 'Registry atomicity',
    ),
    constitutionTableNumbers: constitutionRows.map((row) => row['#'] ?? ''),
    renderEquivalenceAsserted: true,
  };
}

export function v1AcceptanceLedgerGateFact(options: {
  ledger: string;
  spec: string;
}): V1AcceptanceLedgerGateFact {
  const specCriteria = markdownNumberedListItems(
    markdownSection(options.spec, '16. Success Criteria (v1)'),
  ).map((item) => item.split(':')[0] ?? '');
  const gateRows = markdownTableRows(markdownSection(options.ledger, 'Required Gates'));
  const gatesByCriterion = new Map(
    gateRows.map((row) => [markdownRequiredTableCell(row, 'SPEC §16 criterion'), row]),
  );
  const auditRows = markdownTableRows(markdownSection(options.ledger, 'Dated Ledger Audit'));
  const acceptanceRunRows = markdownTableRows(
    markdownSection(options.ledger, 'Acceptance Command Set'),
  );
  const cleanCheckoutRows = markdownTableRows(
    markdownSection(options.ledger, 'Final Clean-Checkout Checklist'),
  );
  const auditStatuses = Object.fromEntries(
    auditRows.map((row) => [
      markdownRequiredTableCell(row, 'Area'),
      markdownRequiredTableCell(row, 'Status'),
    ]),
  );
  const specGateCriteria = specCriteria
    .map((criterion, index) => `16.${index + 1} ${criterion.replace(/ holds$/, '')}`)
    .concat('Pre-launch');
  const gateCriteria = [...gatesByCriterion.keys()];

  return {
    auditRows,
    auditStatuses,
    cleanCheckoutStatuses: cleanCheckoutRows.map((row) => markdownRequiredTableCell(row, 'Status')),
    externalAuditPendingCount: auditRows.filter((row) =>
      markdownRequiredTableCell(row, 'Status').startsWith('pending'),
    ).length,
    gateCriteria,
    gateCriteriaMatchSpec:
      gateCriteria.length === specGateCriteria.length &&
      gateCriteria.every((criterion, index) => criterion === specGateCriteria[index]),
    gateEvidenceArtifacts: Object.fromEntries(
      [...gatesByCriterion].map(([criterion, row]) => [
        criterion,
        row['Current evidence artifact'],
      ]),
    ),
    gateStatuses: Object.fromEntries(
      [...gatesByCriterion].map(([criterion, row]) => [criterion, row.Status]),
    ),
    localAcceptanceAuditPending: auditRows.some(
      (row) =>
        markdownRequiredTableCell(row, 'Area') === 'Local integration acceptance' &&
        markdownRequiredTableCell(row, 'Status') === 'pending',
    ),
    localAcceptanceAuditRunCount: auditRows.filter(
      (row) => markdownRequiredTableCell(row, 'Status') === 'passed local run',
    ).length,
    passedAcceptanceRunCount: acceptanceRunRows.filter(
      (row) => markdownRequiredTableCell(row, 'Result') === 'passed',
    ).length,
    pendingFreezeRunCount: acceptanceRunRows.filter(
      (row) =>
        markdownRequiredTableCell(row, 'Result') === 'pending' &&
        markdownRequiredTableCell(row, 'Commit') === 'TBD at freeze run',
    ).length,
    runFacts: acceptanceRunRows.map((row) => ({
      command: markdownRequiredTableCell(row, 'Command'),
      commit: markdownRequiredTableCell(row, 'Commit'),
      result: markdownRequiredTableCell(row, 'Result'),
    })),
    specGateCriteria,
  };
}
