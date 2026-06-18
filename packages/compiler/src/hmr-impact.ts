import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import type { ComponentCssAsset } from './css.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import { clientModuleVersion } from './lower/handlers.js';
import type {
  ComponentGraphFact,
  HmrImpactClassification,
  HmrImpactMetadata,
  HmrImpactReason,
  LiveTargetFact,
  QueryUpdatePlanFact,
  RenderEquivalenceCheck,
} from './types.js';

interface HmrImpactMetadataInput {
  clientHref: string | null;
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  diagnostics: readonly CompilerDiagnostic[];
  liveTargetFacts: readonly LiveTargetFact[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  renderEquivalenceChecks: readonly RenderEquivalenceCheck[];
  sourceFileName: string;
  stylesheetSources?: readonly {
    source: string;
    sourceFileName: string;
  }[];
}

/**
 * Build compiler HMR metadata from typed parsed/lowered facts only. SPEC §5.2 rule 9 forbids
 * post-parse source-string heuristics, so this surface intentionally stores canonical fact hashes
 * and emitted hrefs instead of rescanning authored source text.
 */
export function createComponentHmrImpactMetadata(
  input: HmrImpactMetadataInput,
): HmrImpactMetadata {
  const component = singleComponentFact(input.componentGraphFacts);
  const diagnostics = input.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnosticSeverity(diagnostic),
  }));
  const stylesheetContentHashes = new Map(
    (input.stylesheetSources ?? []).map((source) => [
      source.sourceFileName,
      factHash(source.source),
    ]),
  );
  const stylesheetAssets = input.cssAssets.map((asset) => {
    const contentHash = stylesheetContentHashes.get(asset.sourceFileName);

    return {
      ...(contentHash ? { contentHash } : {}),
      ...(asset.cspHash ? { cspHash: asset.cspHash } : {}),
      href: asset.href,
      sourceFileName: asset.sourceFileName,
      ...(asset.styleRuleUsages ? { styleRuleUsages: asset.styleRuleUsages } : {}),
    };
  });
  const queryUpdatePlanHash = factHash(input.queryUpdatePlans);
  const liveTargetFactsHash = factHash(input.liveTargetFacts);
  const stylesheetAssetsHash = factHash(stylesheetAssets);
  const renderOutputHash = factHash(
    input.renderEquivalenceChecks.map((check) => ({
      actual: normalizeCompilerClientVersions(check.actual),
      artifact: check.artifact,
      expected: normalizeCompilerClientVersions(check.expected),
      ok: check.ok,
    })),
  );

  const metadata = {
    clientHref: input.clientHref,
    component,
    diagnostics,
    liveTargetFacts: input.liveTargetFacts,
    liveTargetFactsHash,
    queryUpdatePlanHash,
    routeShellHash: null,
    sourceFileName: input.sourceFileName,
    sourceKind: 'component' as const,
    stylesheetAssets,
    stylesheetAssetsHash,
    renderOutputHash,
  };

  return {
    ...metadata,
    factHash: factHash(metadata),
  };
}

/**
 * Compare previous and next compiler HMR metadata and choose the smallest sound dev action.
 * The classifier is deliberately conservative: missing or incompatible facts become a full reload
 * instead of a stale client-side patch (SPEC.md §9.5.1).
 */
export function classifyHmrImpact(
  previous: HmrImpactMetadata | null | undefined,
  next: HmrImpactMetadata | null | undefined,
): HmrImpactClassification {
  if (!previous || !next) return fullReload('missing-facts');
  if (next.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { impact: 'diagnosticError', reasons: ['diagnostics'] };
  }
  if (previous.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return fullReload('diagnostics');
  }
  if (previous.sourceFileName !== next.sourceFileName) return fullReload('topology');
  if (previous.sourceKind !== next.sourceKind) return fullReload('topology');
  if (next.sourceKind === 'route-shell') return { impact: 'routeRefresh', reasons: ['route-shell'] };
  if (!previous.component || !next.component) return fullReload('missing-facts');
  if (
    previous.component.registryKey !== next.component.registryKey ||
    previous.component.domLeaf !== next.component.domLeaf
  ) {
    return fullReload('topology');
  }
  const reasons: HmrImpactReason[] = [];
  if (previous.queryUpdatePlanHash !== next.queryUpdatePlanHash) reasons.push('query-plan');
  if (previous.stylesheetAssetsHash !== next.stylesheetAssetsHash) reasons.push('style');
  if (reasons.length > 0) return { impact: 'routeRefresh', reasons };
  if (previous.liveTargetFactsHash !== next.liveTargetFactsHash) return fullReload('live-target');

  const hasRefreshableTarget = next.liveTargetFacts.length > 0;
  if (previous.renderOutputHash !== next.renderOutputHash) {
    return hasRefreshableTarget
      ? { impact: 'componentRefresh', reasons: ['render-output'] }
      : fullReload('missing-facts');
  }
  if (previous.clientHref !== next.clientHref) {
    return hasRefreshableTarget
      ? { impact: 'componentRefresh', reasons: ['handler-only'] }
      : fullReload('missing-facts');
  }
  if (previous.factHash !== next.factHash) return fullReload('topology');

  return { impact: 'componentRefresh', reasons: [] };
}

function singleComponentFact(
  facts: readonly ComponentGraphFact[],
): HmrImpactMetadata['component'] {
  if (facts.length !== 1) return null;
  const [fact] = facts;
  if (!fact) return null;
  const domLeaf = fact.disambiguatedDomName ?? fact.domName;
  if (!domLeaf) return null;

  return {
    domLeaf,
    registryKey: fact.name,
  };
}

function fullReload(reason: HmrImpactReason): HmrImpactClassification {
  return { impact: 'fullReload', reasons: [reason] };
}

function diagnosticSeverity(diagnostic: CompilerDiagnostic): CompilerDiagnostic['severity'] {
  return diagnosticDefinitions[diagnostic.code]?.severity ?? diagnostic.severity;
}

function factHash(value: unknown): string {
  return clientModuleVersion(canonicalJson(value));
}

function normalizeCompilerClientVersions(value: string): string {
  return value.replace(/\/c\/([^"'#?\s]+\.client\.js)\?v=[0-9a-f]{8}/g, '/c/$1');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
