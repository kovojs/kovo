import { isRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import {
  contextualizeCompilerDiagnostic,
  createDiagnosticFactory,
  diagnosticAt,
  diagnosticFor,
} from './diagnostics.js';

describe('compiler diagnostic source anchors', () => {
  it('emits an exact frozen UTF-16 range beside the line-oriented view', () => {
    const diagnostic = diagnosticFor('src/cart.tsx', 'KV436', 'first\nsecond line\n', 8, 6);

    expect(diagnostic).toMatchObject({
      fileName: 'src/cart.tsx',
      length: 6,
      source: { end: 14, file: 'src/cart.tsx', start: 8 },
      start: { column: 3, line: 2 },
    });
    expect(Object.isFrozen(diagnostic.source)).toBe(true);
    expect(isRegisteredDiagnostic(diagnostic)).toBe(true);
  });

  it('maps an exclusive generated range back through the authored offset map', () => {
    const factory = createDiagnosticFactory('src/cart.tsx', 'abcdefghij012345', {
      generatedLength: 5,
      originalLength: 16,
      segments: [{ generatedStart: 0, length: 5, originalStart: 10 }],
    });
    const diagnostic = diagnosticAt(factory, 'KV436', { length: 4, start: 1 });

    expect(diagnostic).toMatchObject({
      source: { end: 15, file: 'src/cart.tsx', start: 11 },
      start: { column: 12, line: 1 },
    });
  });

  it('preserves exact source authority while contextualizing a registered diagnostic', () => {
    const original = diagnosticFor('src/cart.tsx', 'KV436', '<query />', 1, 5);
    const contextual = contextualizeCompilerDiagnostic(original, {
      message: 'Contextual access decision.',
    });

    expect(contextual.source).toEqual({ end: 6, file: 'src/cart.tsx', start: 1 });
    expect(contextual.source).not.toBe(original.source);
    expect(Object.isFrozen(contextual.source)).toBe(true);
    expect(isRegisteredDiagnostic(contextual)).toBe(true);
  });

  it('fails closed on a source range outside the authored source', () => {
    expect(() => diagnosticFor('src/cart.tsx', 'KV436', 'abc', 2, 2)).toThrow(
      /within authored source/u,
    );
  });
});
