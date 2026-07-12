import type { KovoApp } from './app-types.js';
import { appSystemResponse } from './app-system-response.js';
import {
  requestStateAbsoluteUrlOrigin,
  requestStateBoundedControlToken,
  requestStateIgnorePromiseRejection,
  requestStateIndexOf,
  requestStateJsonStringify,
  requestStateMax,
  requestStateNow,
  requestStateParseJson,
  requestStateRegExpTest,
  requestStateSlice,
  requestStateToLowerCase,
  requestStateToUpperCase,
  requestStateTrim,
} from './request-state-intrinsics.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessMapSize,
  witnessReflectApply,
  witnessWeakMapDelete,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

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

const NativeRequest = globalThis.Request;
const NativeTextDecoder = globalThis.TextDecoder;
const nativeArrayJoin = Array.prototype.join;
const nativeArrayPush = Array.prototype.push;
const nativeReaderCancel = globalThis.ReadableStreamDefaultReader.prototype.cancel;
const nativeReaderRead = globalThis.ReadableStreamDefaultReader.prototype.read;
const nativeRequestBody = witnessGetOwnPropertyDescriptor(NativeRequest.prototype, 'body')?.get;
const nativeRequestMethod = witnessGetOwnPropertyDescriptor(NativeRequest.prototype, 'method')?.get;
const nativeStreamGetReader = globalThis.ReadableStream.prototype.getReader;
const nativeTextDecoderDecode = NativeTextDecoder.prototype.decode;
const nativeUint8ArraySlice = Uint8Array.prototype.slice;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return witnessReflectApply<Return>(fn, receiver, args);
}

function reportingControlsAreSound(): boolean {
  try {
    if (
      typeof nativeRequestBody !== 'function' ||
      typeof nativeRequestMethod !== 'function' ||
      typeof nativeStreamGetReader !== 'function' ||
      typeof nativeReaderRead !== 'function' ||
      typeof nativeReaderCancel !== 'function' ||
      typeof nativeTextDecoderDecode !== 'function' ||
      typeof nativeUint8ArraySlice !== 'function'
    ) {
      return false;
    }
    const request = new NativeRequest('https://kovo.local/report-control', {
      body: 'A',
      method: 'POST',
    });
    if (apply(nativeRequestMethod, request, []) !== 'POST') return false;
    const body = apply<ReadableStream<Uint8Array> | null>(nativeRequestBody, request, []);
    if (body === null) return false;
    const reader = apply<ReadableStreamDefaultReader<Uint8Array>>(nativeStreamGetReader, body, []);
    const read = apply<Promise<ReadableStreamReadResult<Uint8Array>>>(nativeReaderRead, reader, []);
    if (!(read instanceof Promise)) return false;
    const cancel = apply<Promise<void>>(nativeReaderCancel, reader, []);
    if (!(cancel instanceof Promise)) return false;
    requestStateIgnorePromiseRejection(read);
    requestStateIgnorePromiseRejection(cancel);
    if (
      apply(nativeTextDecoderDecode, new NativeTextDecoder(), [new Uint8Array([65])]) !== 'A'
    ) {
      return false;
    }
    const bytes = apply<Uint8Array>(nativeUint8ArraySlice, new Uint8Array([1, 2, 3]), [0, 2]);
    if (bytes.length !== 2 || bytes[0] !== 1 || bytes[1] !== 2) return false;
    const values: string[] = [];
    apply(nativeArrayPush, values, ['a']);
    apply(nativeArrayPush, values, ['b']);
    if (apply(nativeArrayJoin, values, ['']) !== 'ab') return false;
    return true;
  } catch {
    return false;
  }
}

const reportingControlsSound = reportingControlsAreSound();
const reportingStates = createWitnessWeakMap<KovoApp, ReportingState>();

function assertReportingControls(): void {
  if (!reportingControlsSound) {
    throw new TypeError(
      'Kovo reporting controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

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
  assertReportingControls();
  const method = apply<string>(nativeRequestMethod!, request, []);
  if (requestStateToUpperCase(method) !== 'POST') {
    return appSystemResponse(null, {
      headers: { Allow: 'POST' },
      status: 405,
      surface: 'other',
    });
  }

  await collectSecurityReports(app, request, requestStateNow());
  return appSystemResponse(null, {
    headers: { 'Cache-Control': 'no-store' },
    status: 204,
    surface: 'other',
  });
}

/** @internal */
export function kovoSecurityReportSnapshot(app: KovoApp): KovoSecurityReportSnapshot {
  const state = witnessWeakMapGet(reportingStates, app);
  if (!state) return { aggregates: [], dropped: 0 };
  const aggregates: Readonly<ReportAggregate>[] = [];
  witnessMapForEach(state.aggregates, (aggregate) => {
    aggregates[aggregates.length] = {
      count: aggregate.count,
      firstSeen: aggregate.firstSeen,
      lastSeen: aggregate.lastSeen,
      report: { ...aggregate.report },
    };
  });
  return {
    aggregates,
    dropped: state.dropped,
  };
}

/** @internal */
export function resetKovoSecurityReportsForTest(app: KovoApp): void {
  witnessWeakMapDelete(reportingStates, app);
}

async function collectSecurityReports(app: KovoApp, request: Request, now: number): Promise<void> {
  const state = reportingState(app, now);
  if (!consumeReportRate(state, now)) return;

  const body = await readBoundedReportBody(request, MAX_REPORT_BODY_BYTES);
  if (body.truncated) state.dropped += 1;
  if (requestStateTrim(body.text) === '') return;

  const decoded = parseJson(body.text);
  if (!decoded.ok) {
    state.dropped += 1;
    return;
  }

  const reports = reportItems(decoded.value);
  if (reports.length > MAX_REPORTS_PER_REQUEST) {
    state.dropped += reports.length - MAX_REPORTS_PER_REQUEST;
  }
  const accepted = reports.length < MAX_REPORTS_PER_REQUEST ? reports.length : MAX_REPORTS_PER_REQUEST;
  for (let index = 0; index < accepted; index += 1) {
    const raw = reports[index];
    const report = normalizeSecurityReport(raw);
    if (!report) {
      state.dropped += 1;
      continue;
    }
    aggregateReport(state, report, now);
  }
}

function reportingState(app: KovoApp, now: number): ReportingState {
  const existing = witnessWeakMapGet(reportingStates, app);
  if (existing) return existing;
  const created: ReportingState = {
    aggregates: createWitnessMap(),
    dropped: 0,
    rate: { count: 0, startedAt: now },
  };
  witnessWeakMapSet(reportingStates, app, created);
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
  assertReportingControls();
  const body = apply<ReadableStream<Uint8Array> | null>(nativeRequestBody!, request, []);
  if (body === null) return { text: '', truncated: false };
  const reader = apply<ReadableStreamDefaultReader<Uint8Array>>(nativeStreamGetReader, body, []);
  const decoder = new NativeTextDecoder();
  const chunks: string[] = [];
  let size = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await apply<Promise<ReadableStreamReadResult<Uint8Array>>>(
        nativeReaderRead,
        reader,
        [],
      );
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        truncated = true;
        const allowed = requestStateMax(0, value.byteLength - (size - maxBytes));
        if (allowed > 0) {
          const accepted = apply<Uint8Array>(nativeUint8ArraySlice, value, [0, allowed]);
          apply(nativeArrayPush, chunks, [
            apply(nativeTextDecoderDecode, decoder, [accepted, { stream: true }]),
          ]);
        }
        requestStateIgnorePromiseRejection(apply(nativeReaderCancel, reader, []));
        break;
      }
      apply(nativeArrayPush, chunks, [
        apply(nativeTextDecoderDecode, decoder, [value, { stream: true }]),
      ]);
    }
  } finally {
    apply(nativeArrayPush, chunks, [apply(nativeTextDecoderDecode, decoder, [])]);
  }

  return { text: apply(nativeArrayJoin, chunks, ['']), truncated };
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: requestStateParseJson(value) };
  } catch {
    return { ok: false };
  }
}

function reportItems(decoded: unknown): unknown[] {
  if (witnessIsArray(decoded)) return decoded;
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
  const reportKeys = [
    'blocked',
    'disposition',
    'document',
    'effectivePolicy',
    'feature',
    'violatedDirective',
  ] as const;
  for (let index = 0; index < reportKeys.length; index += 1) {
    const key = reportKeys[index]!;
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
  const existing = witnessMapGet(state.aggregates, key);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    witnessMapDelete(state.aggregates, key);
    witnessMapSet(state.aggregates, key, existing);
    return;
  }

  while (witnessMapSize(state.aggregates) >= MAX_REPORT_AGGREGATES) {
    let oldest: string | undefined;
    witnessMapForEach(state.aggregates, (_aggregate, candidate) => {
      if (oldest === undefined) oldest = candidate;
    });
    if (oldest === undefined) break;
    witnessMapDelete(state.aggregates, oldest);
    state.dropped += 1;
  }
  witnessMapSet(state.aggregates, key, { count: 1, firstSeen: now, lastSeen: now, report });
}

function reportKey(report: NormalizedSecurityReport): string {
  const key = requestStateJsonStringify([
    report.type,
    report.document,
    report.violatedDirective,
    report.effectivePolicy,
    report.feature,
    report.blocked,
    report.disposition,
  ]);
  if (key === undefined) throw new TypeError('Kovo reporting fingerprint controls are unavailable.');
  return key;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boundedToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requestStateBoundedControlToken(value, 160);
}

function redactedUrl(value: string | undefined): string | undefined {
  const token = boundedToken(value);
  if (token === undefined) return undefined;
  if (requestStateRegExpTest(/^(inline|eval|self|none)$/i, token)) {
    return requestStateToLowerCase(token);
  }
  if (requestStateRegExpTest(/^(data|blob|filesystem|about|javascript):/i, token)) {
    const colon = requestStateIndexOf(token, ':');
    return `${requestStateToLowerCase(requestStateSlice(token, 0, colon))}:`;
  }
  // L14/M9 (SPEC §6.6): keep only a pinned absolute URL origin. Paths, queries, fragments,
  // credentials, malformed values, and relative paths are never retained as "redacted" telemetry.
  return requestStateAbsoluteUrlOrigin(token) ?? 'opaque';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
