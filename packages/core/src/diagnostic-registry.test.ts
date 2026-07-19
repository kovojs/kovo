import { describe, expect, it } from 'vitest';

import { createRegisteredDiagnostic, diagnosticDefinitions } from './diagnostics.js';
import {
  diagnosticConstructors,
  diagnosticRegistry,
} from './internal/diagnostic-registry.generated.js';

describe('generated diagnostic registry and constructors (SPEC §2/§11)', () => {
  it('binds every definition to one enforcement class and typed constructor', () => {
    const definitionCodes = Object.keys(diagnosticDefinitions).sort();
    expect(Object.keys(diagnosticRegistry).sort()).toEqual(definitionCodes);
    expect(Object.keys(diagnosticConstructors).sort()).toEqual(definitionCodes);

    for (const code of definitionCodes) {
      const typedCode = code as keyof typeof diagnosticDefinitions;
      expect(diagnosticRegistry[typedCode]).toMatchObject(diagnosticDefinitions[typedCode]);
      expect(diagnosticRegistry[typedCode].code).toBe(typedCode);
      expect(['compile-error', 'fail-closed-runtime', 'audited-escape']).toContain(
        diagnosticRegistry[typedCode].enforcementClass,
      );
      expect(Object.isFrozen(diagnosticRegistry[typedCode])).toBe(true);
      expect(diagnosticConstructors[typedCode]().code).toBe(typedCode);
      expect(diagnosticConstructors[typedCode]().severity).toBe(
        diagnosticDefinitions[typedCode].severity,
      );
    }
  });

  it('derives registry-owned fields while preserving validated contextual own data', () => {
    expect(
      diagnosticConstructors.KV228(
        { fileName: '/products/:id <-> /products/:slug' },
        { detail: 'Both routes match /products/p1.', includeHelp: true },
      ),
    ).toEqual({
      code: 'KV228',
      fileName: '/products/:id <-> /products/:slug',
      help: diagnosticDefinitions.KV228.help,
      message: `${diagnosticDefinitions.KV228.message} Both routes match /products/p1.`,
      severity: diagnosticDefinitions.KV228.severity,
    });

    expect(
      createRegisteredDiagnostic('KV313', { cause: 'transform threw' }, { message: 'settled' }),
    ).toEqual({
      cause: 'transform threw',
      code: 'KV313',
      message: 'settled',
      severity: 'error',
    });
  });

  it('rejects unregistered codes, reserved overrides, accessors, and malformed options', () => {
    // diagnostics-ref-ignore KV999: intentional unregistered-code rejection fixture
    expect(() => createRegisteredDiagnostic('KV999' as never)).toThrow(/registered/u);
    expect(() => diagnosticConstructors.KV415({ severity: 'notice' } as never)).toThrow(
      /cannot override.*severity/u,
    );

    let getterReads = 0;
    const fields = Object.defineProperty({}, 'site', {
      enumerable: true,
      get() {
        getterReads += 1;
        return 'attacker-controlled';
      },
    });
    expect(() => diagnosticConstructors.KV415(fields)).toThrow(/own data/u);
    expect(getterReads).toBe(0);
    expect(() => diagnosticConstructors.KV415({}, { detail: 'one', message: 'two' })).toThrow(
      /detail or message/u,
    );
  });

  it('freezes generated registry and constructor authority', () => {
    expect(Object.isFrozen(diagnosticRegistry)).toBe(true);
    expect(Object.isFrozen(diagnosticConstructors)).toBe(true);
    expect(Reflect.set(diagnosticRegistry.KV415, 'enforcementClass', 'audited-escape')).toBe(false);
    expect(Reflect.deleteProperty(diagnosticConstructors, 'KV415')).toBe(false);
  });
});
