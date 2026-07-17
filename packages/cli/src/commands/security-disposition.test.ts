import { describe, expect, it } from 'vitest';

import {
  kovoInvocationEnvironmentValue,
  snapshotKovoInvocationEnvironment,
} from '../invocation-environment.js';

describe('CLI invocation environment authority (SPEC §6.6 rule 6)', () => {
  it('copies only own values into an immutable null-prototype snapshot', () => {
    const source = { OPERATOR_VALUE: 'pinned' } as NodeJS.ProcessEnv;
    const snapshot = snapshotKovoInvocationEnvironment(source);

    Object.defineProperty(Object.prototype, 'KOVO_PRESET', {
      configurable: true,
      value: 'cloudflare',
    });
    Object.defineProperty(Object.prototype, 'KOVO_ADMIN_DATABASE_URL', {
      configurable: true,
      value: 'postgres://attacker@127.0.0.1:2/attacker',
    });
    try {
      expect(Object.getPrototypeOf(snapshot)).toBeNull();
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(snapshot.OPERATOR_VALUE).toBe('pinned');
      expect(snapshot.KOVO_PRESET).toBeUndefined();
      expect(snapshot.KOVO_ADMIN_DATABASE_URL).toBeUndefined();
    } finally {
      delete (Object.prototype as Record<string, unknown>).KOVO_PRESET;
      delete (Object.prototype as Record<string, unknown>).KOVO_ADMIN_DATABASE_URL;
    }
  });

  it('rejects accessor-backed and unstable environment values', () => {
    const accessor = Object.create(null) as NodeJS.ProcessEnv;
    Object.defineProperty(accessor, 'KOVO_PRESET', {
      enumerable: true,
      get: () => 'vercel',
    });
    expect(() => snapshotKovoInvocationEnvironment(accessor)).toThrow(/changed while|own string/u);

    let descriptorReads = 0;
    const unstable = new Proxy({ KOVO_PRESET: 'node' } as NodeJS.ProcessEnv, {
      getOwnPropertyDescriptor(_target, property) {
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          value: descriptorReads % 2 === 0 ? 'node' : 'vercel',
          writable: true,
        };
      },
    });
    expect(() => snapshotKovoInvocationEnvironment(unstable)).toThrow(/changed while/u);
  });

  it('mirrors Windows case-insensitive CLI posture lookup while preserving operator spellings', () => {
    const source = {
      Cf_Pages: '1',
      Cloudflare: '1',
      host: '127.0.0.1',
      Kovo_Admin_Database_Url: 'postgres://admin@db.example:5432/app?sslmode=verify-full',
      kovo_cli_transform_types: '1',
      kovo_database_url: 'postgres://app@db.example:5432/app?sslmode=verify-full',
      Kovo_Data_Dir: '.kovo/windows-data',
      kovo_db_driver: 'node-postgres',
      Kovo_Paranoid: 'true',
      kovo_preset: 'node',
      Kovo_Runtime_Database_Url: 'postgres://runtime@db.example:5432/app?sslmode=verify-full',
      node_env: 'production',
      Node_Tls_Reject_Unauthorized: '0',
      Port: '4173',
      vercel: '1',
    } as NodeJS.ProcessEnv;
    const snapshot = snapshotKovoInvocationEnvironment(source, true);
    const expectedLookups = {
      CF_PAGES: '1',
      CLOUDFLARE: '1',
      HOST: '127.0.0.1',
      KOVO_ADMIN_DATABASE_URL: 'postgres://admin@db.example:5432/app?sslmode=verify-full',
      KOVO_CLI_TRANSFORM_TYPES: '1',
      KOVO_DATABASE_URL: 'postgres://app@db.example:5432/app?sslmode=verify-full',
      KOVO_DATA_DIR: '.kovo/windows-data',
      KOVO_DB_DRIVER: 'node-postgres',
      KOVO_PARANOID: 'true',
      KOVO_PRESET: 'node',
      KOVO_RUNTIME_DATABASE_URL: 'postgres://runtime@db.example:5432/app?sslmode=verify-full',
      NODE_ENV: 'production',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      PORT: '4173',
      VERCEL: '1',
    } as const;

    for (const [name, value] of Object.entries(expectedLookups)) {
      expect(kovoInvocationEnvironmentValue(snapshot, name), name).toBe(value);
    }
    expect(Object.getOwnPropertyNames(snapshot)).toEqual(Object.keys(source));
    expect(snapshot.node_env).toBe('production');
    expect(snapshot.NODE_ENV).toBeUndefined();
  });

  it('fails closed on impossible Windows CLI environment case collisions', () => {
    expect(() =>
      snapshotKovoInvocationEnvironment({ Node_Env: 'production', NODE_ENV: 'development' }, true),
    ).toThrow(/case-colliding Windows names Node_Env and NODE_ENV/u);
  });
});
