import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PERF_PUBLICATION_POLICY_PATH = 'perf-publication-policy.json';
export const PERF_PUBLICATION_POLICY_SCHEMA = 'kovo-performance-publication-policy/v1';

const POLICY_BYTES = readFileSync(
  new URL(`../../${PERF_PUBLICATION_POLICY_PATH}`, import.meta.url),
);
const parsedPolicy = JSON.parse(POLICY_BYTES.toString('utf8'));

validatePolicy(parsedPolicy);

export const PERF_PUBLICATION_POLICY = deepFreeze(parsedPolicy);
export const PERF_PUBLICATION_POLICY_IDENTITY = Object.freeze({
  byteLength: POLICY_BYTES.length,
  contentDigest: `sha256:${createHash('sha256').update(POLICY_BYTES).digest('hex')}`,
  path: PERF_PUBLICATION_POLICY_PATH,
  schema: PERF_PUBLICATION_POLICY_SCHEMA,
});
export const PERF_PUBLICATION_HOLDOUT_REGRESSION = PERF_PUBLICATION_POLICY.holdoutRegression;

const completionMetrics = deepFreeze(
  Object.fromEntries(
    Object.entries(PERF_PUBLICATION_POLICY.families).map(([family, policy]) => [
      family,
      expandMetricTemplates(policy),
    ]),
  ),
);

/** Return the exact, prospectively committed completion-blocking comparison metric census. */
export function performancePublicationCompletionMetrics(family) {
  const metrics = completionMetrics[family];
  if (!Array.isArray(metrics)) {
    throw new TypeError(`unsupported performance publication policy family ${String(family)}`);
  }
  return metrics;
}

/** Validate a retained policy identity without accepting a self-authored replacement. */
export function performancePublicationPolicyIdentityFindings(value, label = 'publication policy') {
  const findings = [];
  if (!ownRecord(value)) return [`${label} identity is unavailable`];
  for (const key of ['byteLength', 'contentDigest', 'path', 'schema']) {
    if (value[key] !== PERF_PUBLICATION_POLICY_IDENTITY[key]) {
      findings.push(`${label} ${key} differs from the committed prospective policy`);
    }
  }
  if (
    canonicalJson(Object.keys(value).sort()) !==
    canonicalJson(Object.keys(PERF_PUBLICATION_POLICY_IDENTITY).sort())
  ) {
    findings.push(`${label} identity field census differs`);
  }
  return findings;
}

function validatePolicy(policy) {
  if (
    !ownRecord(policy) ||
    policy.schema !== PERF_PUBLICATION_POLICY_SCHEMA ||
    policy.campaignPosture !== 'fresh-disjoint-campaigns-started-after-this-policy-is-committed' ||
    policy.reportedMetricPosture !== 'retain-the-exact-complete-analysis-metric-census' ||
    policy.holdoutRegression?.maxRegressionPct !== 5 ||
    policy.holdoutRegression?.madMultiplier !== 3 ||
    policy.publicationRoles?.competitiveTargets !== 'follow-on' ||
    policy.publicationRoles?.correctnessAndIntegrity !== 'completion' ||
    policy.publicationRoles?.milestones !== 'completion' ||
    policy.publicationRoles?.regressionCensus !== 'completion'
  ) {
    throw new TypeError('committed performance publication policy header is malformed');
  }
  if (
    canonicalJson(Object.keys(policy.families ?? {}).sort()) !==
    canonicalJson(['browser', 'server'])
  ) {
    throw new TypeError('committed performance publication family policy census is malformed');
  }
  for (const [family, familyPolicy] of Object.entries(policy.families)) {
    const metrics = expandMetricTemplates(familyPolicy);
    if (metrics.length === 0 || new Set(metrics).size !== metrics.length) {
      throw new TypeError(
        `committed ${family} completion regression census is empty or duplicated`,
      );
    }
  }
}

function expandMetricTemplates(policy) {
  if (
    !ownRecord(policy?.dimensions) ||
    !Array.isArray(policy?.completionRegressionMetricTemplates)
  ) {
    throw new TypeError('performance publication metric template policy is malformed');
  }
  const dimensions = policy.dimensions;
  const expanded = [];
  for (const template of policy.completionRegressionMetricTemplates) {
    if (typeof template !== 'string' || template.length === 0) {
      throw new TypeError('performance publication metric template is malformed');
    }
    const names = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((match) => match[1]);
    const uniqueNames = [...new Set(names)];
    if (
      uniqueNames.length === 0 ||
      uniqueNames.some(
        (name) =>
          !Array.isArray(dimensions[name]) ||
          dimensions[name].length === 0 ||
          new Set(dimensions[name].map(String)).size !== dimensions[name].length,
      )
    ) {
      throw new TypeError(
        `performance publication metric template ${template} has no fixed dimensions`,
      );
    }
    expandTemplate(template, uniqueNames, dimensions, 0, {}, expanded);
  }
  return [...expanded].sort((left, right) => left.localeCompare(right));
}

function expandTemplate(template, names, dimensions, index, selected, output) {
  if (index === names.length) {
    output.push(
      names.reduce(
        (metric, name) => metric.replaceAll(`{${name}}`, String(selected[name])),
        template,
      ),
    );
    return;
  }
  const name = names[index];
  for (const value of dimensions[name]) {
    expandTemplate(template, names, dimensions, index + 1, { ...selected, [name]: value }, output);
  }
}

function deepFreeze(value) {
  if (!ownRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (ownRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
