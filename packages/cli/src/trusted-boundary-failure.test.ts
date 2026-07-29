import { trustedBoundaryFailureDefinition } from '@kovojs/core/internal/graph';
import type { TrustedBoundaryFailureFact } from '@kovojs/core/internal/graph';
import { describe, expect, it } from 'vitest';

import { formatKovoDiagnostics, trustedBoundaryFailureDiagnostic } from './diagnostic.js';
import { trustedBoundaryFailureForMcp } from './commands/mcp.js';

function runtimeFailure(): TrustedBoundaryFailureFact {
  const operation = 'mutation-handler';
  const definition = trustedBoundaryFailureDefinition(operation);
  return Object.freeze({
    code: definition.code,
    correlationId: 'ktb_0123456789abcdef0123456789abcdef',
    operation,
    remediation: definition.remediation,
    safeCause: definition.safeCause,
    schema: 'kovo.trusted-boundary-failure/v1',
    source: Object.freeze({ end: 44, file: 'src/cart.tsx', start: 21 }),
    sourceKind: 'source',
  });
}

describe('trusted-boundary failure projections', () => {
  it('keeps human, JSON, GitHub, and MCP on one bounded fact', () => {
    const failure = runtimeFailure();
    const diagnostic = trustedBoundaryFailureDiagnostic(failure);
    const json = JSON.parse(formatKovoDiagnostics([diagnostic], 'json')) as {
      diagnostics: readonly {
        runtime?: TrustedBoundaryFailureFact;
        source?: TrustedBoundaryFailureFact['source'];
      }[];
    };
    const human = formatKovoDiagnostics([diagnostic], 'human');
    const github = formatKovoDiagnostics([diagnostic], 'github');
    const mcp = trustedBoundaryFailureForMcp(failure);

    expect(diagnostic.runtime).toEqual(failure);
    expect(diagnostic.source).toEqual(failure.source);
    expect(json.diagnostics[0]?.runtime).toEqual(failure);
    expect(json.diagnostics[0]?.source).toEqual(failure.source);
    expect(mcp.failure).toEqual(failure);
    expect(mcp.diagnostics[0]).toEqual(diagnostic);
    expect(mcp.version).toBe('kovo-runtime-failure/v1');
    expect(human).toContain('src/cart.tsx[21:44]');
    expect(human).toContain('CAUSE KTB003 handler-execution-failed');
    expect(human).toContain(`CORRELATION ${failure.correlationId}`);
    expect(human).toContain(`HELP ${failure.remediation}`);
    expect(github).toContain('KTB003 cause=handler-execution-failed');
    expect(github).toContain('file=src/cart.tsx');
    expect(github).toContain('[21%3A44]');
    expect(github).toContain(`correlation=${failure.correlationId}`);
    expect(github).toContain(failure.remediation);
  });

  it('rejects surplus raw causes and registry drift before any projection', () => {
    const failure = runtimeFailure();
    const rawSecret = 'provider-token-should-stay-server-side';

    expect(() =>
      trustedBoundaryFailureDiagnostic({
        ...failure,
        rawCause: rawSecret,
      } as unknown as TrustedBoundaryFailureFact),
    ).toThrow(/surplus field "rawCause"/u);
    expect(() =>
      trustedBoundaryFailureDiagnostic({
        ...failure,
        remediation: rawSecret,
      }),
    ).toThrow(/must match the core registry/u);

    const serialized = JSON.stringify(trustedBoundaryFailureForMcp(failure));
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('payload');
  });

  it('rejects hostile carriers, invalid correlations, and non-relative source paths', () => {
    const failure = runtimeFailure();
    let accessorRead = false;
    const accessor = { ...failure };
    Object.defineProperty(accessor, 'correlationId', {
      enumerable: true,
      get() {
        accessorRead = true;
        return failure.correlationId;
      },
    });
    const customPrototype = Object.setPrototypeOf({ ...failure }, { rawCause: 'hidden' });

    expect(() =>
      trustedBoundaryFailureDiagnostic(accessor as unknown as TrustedBoundaryFailureFact),
    ).toThrow(/correlationId must be an own data field/u);
    expect(accessorRead).toBe(false);
    expect(() =>
      trustedBoundaryFailureDiagnostic(customPrototype as TrustedBoundaryFailureFact),
    ).toThrow(/must not carry a custom prototype/u);
    expect(() =>
      trustedBoundaryFailureDiagnostic({
        ...failure,
        correlationId: 'ktb_not-stable',
      }),
    ).toThrow(/correlation ID is invalid/u);
    expect(() =>
      trustedBoundaryFailureDiagnostic({
        ...failure,
        source: { ...failure.source!, file: '/Users/operator/private/cart.tsx' },
      }),
    ).toThrow(/source file must be a bounded relative path/u);
  });
});
