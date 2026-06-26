import type { KovoApp } from './app-types.js';
import { appSystemResponse } from './app-system-response.js';

interface ReportAggregate {
  count: number;
  firstSeen: number;
  lastSeen: number;
  report: NormalizedSecurityReport;
}

interface ReportRateWindow {
  count: number;
  startedAt: number;
}

interface ReportingState {
  aggregates: Map<string, ReportAggregate>;
  dropped: number;
  rate: ReportRateWindow;
}

interface NormalizedSecurityReport {
  blocked?: string;
  disposition?: string;
  document?: string;
  effectivePolicy?: string;
  feature?: string;
  type: string;
  violatedDirective?: string;
}

interface NormalizedSecurityReportInput {
  blocked?: string | undefined;
  disposition?: string | undefined;
  document?: string | undefined;
  effectivePolicy?: string | undefined;
  feature?: string | undefined;
  type: string;
  violatedDirective?: string | undefined;
}

export interface KovoSecurityReportSnapshot {
  readonly aggregates: readonly Readonly<ReportAggregate>[];
  readonly dropped: number;
}

const MAX_REPORT_BODY_BYTES = 64 * 1024;
const MAX_REPORTS_PER_REQUEST = 20;
const MAX_REPORT_AGGREGATES = 512;
const REPORT_RATE_LIMIT = 1200;
const REPORT_RATE_WINDOW_MS = 60_000;

const reportingStates = new WeakMap<KovoApp, ReportingState>();

/**
 * SPEC §6.6 audit-only telemetry: Reporting API reports are attacker-triggerable
 * browser input. The framework records only redacted, bounded aggregates and always
 * returns a quiet 204 so malformed or excessive reports do not become a retry or
 * reflection amplifier. These reports are runtime observability, not a security proof.
 *
 * @internal
 */
export async function kovoSecurityReportResponse(
  app: KovoApp,
  request: Request,
): Promise<Response> {
  if (request.method.toUpperCase() !== 'POST') {
    return appSystemResponse(null, {
      headers: { Allow: 'POST' },
      status: 405,
      surface: 'other',
    });
  }

  await collectSecurityReports(app, request, Date.now());
  return appSystemResponse(null, {
    headers: { 'Cache-Control': 'no-store' },
    status: 204,
    surface: 'other',
  });
}

/** @internal */
export function kovoSecurityReportSnapshot(app: KovoApp): KovoSecurityReportSnapshot {
  const state = reportingStates.get(app);
  if (!state) return { aggregates: [], dropped: 0 };
  return {
    aggregates: [...state.aggregates.values()].map((aggregate) => ({
      count: aggregate.count,
      firstSeen: aggregate.firstSeen,
      lastSeen: aggregate.lastSeen,
      report: { ...aggregate.report },
    })),
    dropped: state.dropped,
  };
}

/** @internal */
export function resetKovoSecurityReportsForTest(app: KovoApp): void {
  reportingStates.delete(app);
}

async function collectSecurityReports(app: KovoApp, request: Request, now: number): Promise<void> {
  const state = reportingState(app, now);
  if (!consumeReportRate(state, now)) return;

  const body = await readBoundedReportBody(request, MAX_REPORT_BODY_BYTES);
  if (body.truncated) state.dropped += 1;
  if (body.text.trim() === '') return;

  const decoded = parseJson(body.text);
  if (!decoded.ok) {
    state.dropped += 1;
    return;
  }

  const reports = reportItems(decoded.value);
  if (reports.length > MAX_REPORTS_PER_REQUEST) {
    state.dropped += reports.length - MAX_REPORTS_PER_REQUEST;
  }
  for (const raw of reports.slice(0, MAX_REPORTS_PER_REQUEST)) {
    const report = normalizeSecurityReport(raw);
    if (!report) {
      state.dropped += 1;
      continue;
    }
    aggregateReport(state, report, now);
  }
}

function reportingState(app: KovoApp, now: number): ReportingState {
  const existing = reportingStates.get(app);
  if (existing) return existing;
  const created: ReportingState = {
    aggregates: new Map(),
    dropped: 0,
    rate: { count: 0, startedAt: now },
  };
  reportingStates.set(app, created);
  return created;
}

function consumeReportRate(state: ReportingState, now: number): boolean {
  if (now - state.rate.startedAt >= REPORT_RATE_WINDOW_MS) {
    state.rate = { count: 0, startedAt: now };
  }
  state.rate.count += 1;
  if (state.rate.count <= REPORT_RATE_LIMIT) return true;
  state.dropped += 1;
  return false;
}

async function readBoundedReportBody(
  request: Request,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!request.body) return { text: '', truncated: false };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        truncated = true;
        const allowed = Math.max(0, value.byteLength - (size - maxBytes));
        if (allowed > 0) chunks.push(decoder.decode(value.slice(0, allowed), { stream: true }));
        await reader.cancel();
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    chunks.push(decoder.decode());
  }

  return { text: chunks.join(''), truncated };
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function reportItems(decoded: unknown): unknown[] {
  if (Array.isArray(decoded)) return decoded;
  return [decoded];
}

function normalizeSecurityReport(raw: unknown): NormalizedSecurityReport | undefined {
  if (!isRecord(raw)) return undefined;

  const cspReport = raw['csp-report'];
  if (isRecord(cspReport)) {
    return compactReport({
      blocked: redactedUrl(stringValue(cspReport['blocked-uri'])),
      document: redactedUrl(stringValue(cspReport['document-uri'])),
      type: 'csp-violation',
      violatedDirective: boundedToken(stringValue(cspReport['violated-directive'])),
    });
  }

  const type = boundedToken(stringValue(raw.type)) ?? 'unknown';
  const body = isRecord(raw.body) ? raw.body : {};
  return compactReport({
    blocked: redactedUrl(stringValue(body.blockedURL)),
    disposition: boundedToken(stringValue(body.disposition)),
    document: redactedUrl(stringValue(body.documentURL) ?? stringValue(raw.url)),
    effectivePolicy: boundedToken(
      stringValue(body.effectivePolicy) ?? stringValue(body.effectiveDirective),
    ),
    feature: boundedToken(stringValue(body.featureId)),
    type,
    violatedDirective: boundedToken(stringValue(body.effectiveDirective)),
  });
}

function compactReport(
  report: NormalizedSecurityReportInput,
): NormalizedSecurityReport | undefined {
  if (report.type.length === 0) return undefined;
  const compact: NormalizedSecurityReport = { type: report.type };
  for (const key of [
    'blocked',
    'disposition',
    'document',
    'effectivePolicy',
    'feature',
    'violatedDirective',
  ] as const) {
    const value = report[key];
    if (value !== undefined && value.length > 0) compact[key] = value;
  }
  return compact;
}

function aggregateReport(
  state: ReportingState,
  report: NormalizedSecurityReport,
  now: number,
): void {
  const key = reportKey(report);
  const existing = state.aggregates.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    state.aggregates.delete(key);
    state.aggregates.set(key, existing);
    return;
  }

  while (state.aggregates.size >= MAX_REPORT_AGGREGATES) {
    const oldest = state.aggregates.keys().next().value;
    if (oldest === undefined) break;
    state.aggregates.delete(oldest);
    state.dropped += 1;
  }
  state.aggregates.set(key, { count: 1, firstSeen: now, lastSeen: now, report });
}

function reportKey(report: NormalizedSecurityReport): string {
  return JSON.stringify([
    report.type,
    report.document,
    report.violatedDirective,
    report.effectivePolicy,
    report.feature,
    report.blocked,
    report.disposition,
  ]);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boundedToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return replaceControlCharacters(value).trim().slice(0, 160);
}

function replaceControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    result += code < 32 || code === 127 ? ' ' : character;
  }
  return result;
}

function redactedUrl(value: string | undefined): string | undefined {
  const token = boundedToken(value);
  if (token === undefined) return undefined;
  if (/^(inline|eval|self|none)$/i.test(token)) return token.toLowerCase();
  if (/^(data|blob|filesystem|about|javascript):/i.test(token)) {
    return `${token.split(':', 1)[0] ?? 'opaque'}:`;
  }
  try {
    // L14 (SPEC §6.6): the stored aggregate is the framework's "redacted" telemetry, but
    // returning origin+pathname retained the full path verbatim — so a secret embedded in a
    // path segment (reset/magic-link/capability tokens, e.g. `/reset-password/<token>`)
    // persisted unredacted at rest. Keep only the origin; drop the path, query, and fragment
    // so no path-embedded secret is ever stored.
    return new URL(token).origin;
  } catch {
    return token.slice(0, 160);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
