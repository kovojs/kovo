export interface FwCheckDiagnosticFact {
  code: string;
  message: string;
  properties: Record<string, string>;
  raw: string;
  severity: 'ERROR' | 'WARN';
  target: string;
}

export interface FwCheckCoverageFact {
  properties: Record<string, string>;
  raw: string;
}

export interface FwCheckOutput {
  coverage: FwCheckCoverageFact[];
  diagnostics: FwCheckDiagnosticFact[];
  status: 'issues' | 'ok';
  version: 'fw-check/v1';
}

export interface FwCheckResultLike {
  exitCode: number;
  output: string;
}

export interface FwCheckResultFact extends FwCheckOutput {
  exitCode: number;
}

export type FwCheckDiagnosticAssertionFact = Omit<FwCheckDiagnosticFact, 'raw'>;
export type FwCheckCoverageAssertionFact = Omit<FwCheckCoverageFact, 'raw'>;

export interface FwCheckAssertionFact {
  coverage: FwCheckCoverageAssertionFact[];
  diagnostics: FwCheckDiagnosticAssertionFact[];
  exitCode: number;
  status: FwCheckOutput['status'];
  version: FwCheckOutput['version'];
}

export interface FwCheckOkAssertionFact {
  exitCode: 0;
  issueCount: 0;
  status: 'ok';
  version: FwCheckOutput['version'];
}

export interface FwCheckUnguardedAuditBehaviorFact {
  coverage: FwCheckCoverageAssertionFact[];
  diagnostics: FwCheckDiagnosticAssertionFact[];
  exitCode: number;
  status: FwCheckOutput['status'];
  targets: {
    mutation: string[];
    page: string[];
    query: string[];
  };
  version: FwCheckOutput['version'];
}

export interface FwCheckUnguardedAuditGraph {
  mutations: Array<{ guards?: readonly string[]; key: string; writes?: readonly string[] }>;
  optimistic?: Array<{ mutation: string; query: string; status: string }>;
  pages: Array<{ guards?: readonly string[]; queries?: readonly string[]; route: string }>;
  queries: Array<{ domains?: readonly string[]; guards?: readonly string[]; query: string }>;
}

export type FwCheckCommand = (graph: FwCheckUnguardedAuditGraph) => FwCheckResultLike;

export function parseFwCheckOutput(output: string): FwCheckOutput {
  const lines = output.trimEnd().split('\n');
  const version = lines[0];
  if (version !== 'fw-check/v1') {
    throw new Error(`fw check output starts with fw-check/v1: ${version ?? ''}`);
  }

  const body = lines.slice(1).filter((line) => line.length > 0);
  if (body.length === 1 && body[0] === 'OK') {
    return { coverage: [], diagnostics: [], status: 'ok', version };
  }

  const coverage: FwCheckCoverageFact[] = [];
  const diagnostics: FwCheckDiagnosticFact[] = [];

  for (const line of body) {
    if (line.startsWith('COVERAGE ')) {
      coverage.push({
        properties: parseKeyValueFields(line.slice('COVERAGE '.length)),
        raw: line,
      });
      continue;
    }

    const diagnostic = parseFwCheckDiagnostic(line);
    if (!diagnostic) {
      throw new Error(`fw check output line is a diagnostic or coverage fact: ${line}`);
    }
    diagnostics.push(diagnostic);
  }

  return { coverage, diagnostics, status: 'issues', version };
}

export function fwCheckResultFact(result: FwCheckResultLike): FwCheckResultFact {
  return { ...parseFwCheckOutput(result.output), exitCode: result.exitCode };
}

export function fwCheckAssertionFact(result: FwCheckResultLike): FwCheckAssertionFact {
  const fact = fwCheckResultFact(result);

  return {
    coverage: fact.coverage.map(({ raw: _raw, ...coverage }) => coverage),
    diagnostics: fact.diagnostics.map(({ raw: _raw, ...diagnostic }) => diagnostic),
    exitCode: fact.exitCode,
    status: fact.status,
    version: fact.version,
  };
}

export function fwCheckOkAssertionFact(result: FwCheckResultLike): FwCheckOkAssertionFact {
  const fact = fwCheckAssertionFact(result);
  const issueCount = fact.coverage.length + fact.diagnostics.length;
  if (fact.exitCode !== 0 || fact.status !== 'ok' || issueCount !== 0) {
    throw new Error(
      `fw check expected OK: exitCode=${fact.exitCode} status=${fact.status} diagnostics=${fact.diagnostics.length} coverage=${fact.coverage.length}`,
    );
  }

  return {
    exitCode: 0,
    issueCount: 0,
    status: 'ok',
    version: fact.version,
  };
}

export function fwCheckUnguardedAuditBehaviorFact(options: {
  fwCheck: FwCheckCommand;
}): FwCheckUnguardedAuditBehaviorFact {
  // SPEC.md section 6.4 and the archived v1 roadmap require route/query guards to surface
  // through the unguarded audit when removed.
  const fact = fwCheckAssertionFact(
    options.fwCheck({
      mutations: [
        { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
        { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
      ],
      optimistic: [
        { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
        { mutation: 'inventory/sync', query: 'adminOrders', status: 'await-fragment' },
      ],
      pages: [
        { guards: ['authed'], queries: ['cart'], route: '/cart' },
        { guards: [], queries: ['adminOrders'], route: '/admin' },
      ],
      queries: [
        { domains: ['cart'], guards: ['authed'], query: 'cart' },
        { domains: ['product'], guards: [], query: 'adminOrders' },
      ],
    }),
  );
  const unguardedDiagnostics = fact.diagnostics.filter(({ code }) => code === 'UNGUARDED');

  return {
    ...fact,
    targets: {
      mutation: unguardedDiagnostics
        .filter(({ message }) => message === 'mutation is reachable without an auth guard.')
        .map(({ target }) => target),
      page: unguardedDiagnostics
        .filter(({ target }) => target.startsWith('page '))
        .map(({ target }) => target.slice('page '.length)),
      query: unguardedDiagnostics
        .filter(({ target }) => target.startsWith('query '))
        .map(({ target }) => target.slice('query '.length)),
    },
  };
}

export function fwCheckDiagnosticFacts(output: string): FwCheckDiagnosticFact[] {
  return parseFwCheckOutput(output).diagnostics;
}

export function fwCheckDiagnosticAssertionFacts(output: string): FwCheckDiagnosticAssertionFact[] {
  return fwCheckDiagnosticFacts(output).map(({ raw: _raw, ...fact }) => fact);
}

export function fwCheckCoverageFacts(output: string): FwCheckCoverageFact[] {
  return parseFwCheckOutput(output).coverage;
}

export function fwCheckCoverageAssertionFacts(output: string): FwCheckCoverageAssertionFact[] {
  return fwCheckCoverageFacts(output).map(({ raw: _raw, ...fact }) => fact);
}

function parseFwCheckDiagnostic(line: string): FwCheckDiagnosticFact | undefined {
  const match = /^(ERROR|WARN) (\S+)(?: (.*))?$/.exec(line);
  if (!match) return undefined;

  const severity = match[1] as 'ERROR' | 'WARN';
  const code = match[2] ?? '';
  const detail = match[3] ?? '';
  const parsedProperties = leadingKeyValueFields(detail);
  const properties = parsedProperties.fields;
  const rest =
    parsedProperties.consumedLength > 0
      ? detail.slice(parsedProperties.consumedLength).trimStart()
      : detail;
  const parsed = parseTargetAndMessage(code, rest);

  return {
    code,
    message: parsed.message,
    properties,
    raw: line,
    severity,
    target: parsed.target,
  };
}

function parseTargetAndMessage(code: string, detail: string): { message: string; target: string } {
  if (detail.length === 0) return { message: '', target: '' };

  if (code === 'FW310') {
    const message = 'Invalidated query lacks optimistic transform.';
    return detail.endsWith(message)
      ? { message, target: detail.slice(0, -message.length).trimEnd() }
      : { message: detail, target: '' };
  }

  if (code === 'FW311') {
    const message = 'Query-dependent DOM position has no update status.';
    return detail === message ? { message, target: '' } : { message: detail, target: '' };
  }

  if (code === 'UNGUARDED') {
    if (detail.startsWith('page ') || detail.startsWith('query ')) {
      const [kind = '', target = '', ...messageParts] = detail.split(/\s+/);
      return { message: messageParts.join(' '), target: `${kind} ${target}` };
    }
  }

  const [target, ...messageParts] = detail.split(/\s+/);
  return { message: messageParts.join(' '), target: target ?? '' };
}

function leadingKeyValueFields(source: string): {
  consumedLength: number;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  let consumedLength = 0;
  let index = 0;

  while (index < source.length) {
    while (source[index] === ' ') index += 1;
    const start = index;
    const separator = source.indexOf('=', start);
    if (separator === -1) break;

    const key = source.slice(start, separator);
    if (key.length === 0 || /\s/.test(key)) break;

    let value = '';
    let nextIndex = separator + 1;
    if (source[nextIndex] === '"') {
      nextIndex += 1;
      while (nextIndex < source.length) {
        const character = source[nextIndex];
        if (character === '"') {
          nextIndex += 1;
          break;
        }
        if (character === '\\' && nextIndex + 1 < source.length) {
          value += source[nextIndex + 1];
          nextIndex += 2;
          continue;
        }
        value += character;
        nextIndex += 1;
      }
    } else {
      const valueStart = nextIndex;
      while (nextIndex < source.length && !/\s/.test(source[nextIndex]!)) nextIndex += 1;
      value = source.slice(valueStart, nextIndex);
    }

    if (key.length === 0 || value.length === 0) break;
    fields[key] = value;
    consumedLength = nextIndex;
    index = nextIndex;
  }

  return { consumedLength, fields };
}

function parseKeyValueFields(source: string): Record<string, string> {
  const parsed = leadingKeyValueFields(source);
  const rest = source.slice(parsed.consumedLength).trim();
  if (rest.length > 0) {
    throw new Error(`fw check coverage fields are key=value entries: ${source}`);
  }
  return parsed.fields;
}
