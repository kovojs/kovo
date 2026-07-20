import { parseAdvisoryFeed, type KovoSecurityAdvisoryFeed } from './advisories.js';

const MAX_PUBLISHED_FEED_AGE_SECONDS = 90 * 24 * 60 * 60;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

interface GuaranteeLedger {
  readonly advisories?: readonly unknown[];
  readonly guarantees?: readonly unknown[];
}

interface TcbManifest {
  readonly entries?: readonly unknown[];
}

/** @internal Cross-ledger repository gate for the live advisory feed (SPEC §11.4). */
export function collectAdvisoryFeedGateFindings(
  feedValue: unknown,
  guaranteeValue: unknown,
  tcbValue: unknown,
  now: number,
): { readonly feed?: KovoSecurityAdvisoryFeed; readonly findings: readonly string[] } {
  const findings: string[] = [];
  let feed: KovoSecurityAdvisoryFeed;
  try {
    feed = parseAdvisoryFeed(feedValue);
  } catch (error) {
    return {
      findings: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (!Number.isFinite(now)) findings.push('advisory feed gate clock is invalid');
  const issuedAt = Date.parse(feed.issuedAt);
  if (issuedAt > now + MAX_FUTURE_SKEW_MS) findings.push('live advisory feed is future-dated');
  if (now - issuedAt > feed.maxFeedAgeSeconds * 1_000) {
    findings.push('live advisory feed is stale beyond maxFeedAgeSeconds');
  }
  if (feed.maxFeedAgeSeconds > MAX_PUBLISHED_FEED_AGE_SECONDS) {
    findings.push('live advisory feed maxFeedAgeSeconds exceeds the 90-day release ceiling');
  }

  const guaranteeLedger = objectValue(guaranteeValue) as GuaranteeLedger | undefined;
  const tcbManifest = objectValue(tcbValue) as TcbManifest | undefined;
  const guarantees = idSet(guaranteeLedger?.guarantees, 'SECURITY guarantees', findings);
  const tcbChokes = idSet(tcbManifest?.entries, 'TCB entries', findings);
  const registeredAdvisories = advisoryMap(guaranteeLedger?.advisories, findings);

  const feedIds = feed.advisories.map((advisory) => advisory.id);
  if (!isSorted(feedIds)) findings.push('live advisory feed advisories must be sorted by id');
  for (const advisory of feed.advisories) {
    for (const guarantee of advisory.retracts) {
      if (!guarantees.has(guarantee)) {
        findings.push(`${advisory.id} retracts unknown SECURITY guarantee ${guarantee}`);
      }
    }
    for (const choke of advisory.tcbChokes) {
      if (!tcbChokes.has(choke)) findings.push(`${advisory.id} names unknown TCB choke ${choke}`);
    }
    const registered = registeredAdvisories.get(advisory.id);
    if (registered === undefined) {
      findings.push(`${advisory.id} is absent from the SECURITY advisory register`);
      continue;
    }
    if (!sameStringSet(advisory.retracts, registered)) {
      findings.push(`${advisory.id} retracts drift from the SECURITY advisory register`);
    }
  }
  for (const id of registeredAdvisories.keys()) {
    if (!feedIds.includes(id)) {
      findings.push(`SECURITY advisory ${id} is missing from the live advisory feed`);
    }
  }
  return { feed, findings: Object.freeze(findings) };
}

function idSet(
  value: readonly unknown[] | undefined,
  label: string,
  findings: string[],
): Set<string> {
  if (!Array.isArray(value)) {
    findings.push(`${label} must be an array`);
    return new Set();
  }
  const output = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const id = objectValue(entry)?.id;
    if (typeof id !== 'string' || id === '') {
      findings.push(`${label}[${index}] must have a non-empty id`);
      continue;
    }
    output.add(id);
  }
  return output;
}

function advisoryMap(
  value: readonly unknown[] | undefined,
  findings: string[],
): Map<string, readonly string[]> {
  if (!Array.isArray(value)) {
    findings.push('SECURITY advisories must be an array');
    return new Map();
  }
  const output = new Map<string, readonly string[]>();
  for (const [index, entry] of value.entries()) {
    const row = objectValue(entry);
    if (typeof row?.id !== 'string' || row.id === '' || !Array.isArray(row.retracts)) {
      findings.push(`SECURITY advisories[${index}] must have id and retracts`);
      continue;
    }
    const retracts = row.retracts.filter((item): item is string => typeof item === 'string');
    if (retracts.length !== row.retracts.length) {
      findings.push(`SECURITY advisories[${index}].retracts must contain strings`);
      continue;
    }
    output.set(row.id, Object.freeze(retracts));
  }
  return output;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((entry, index) => entry === [...right].sort()[index])
  );
}

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? '') < value);
}
