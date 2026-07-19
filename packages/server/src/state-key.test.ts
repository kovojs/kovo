import { describe, expect, it } from 'vitest';
import { scopedKeyFactsFor } from '@kovojs/core/internal/storage';

import { registerFrameworkSessionPrincipalSnapshot } from './auth-principal.js';
import { scopedKey } from './state-key.js';

describe('request ScopedKey authority (SPEC §6.6 C9)', () => {
  it('binds keys to the framework-installed authenticated principal snapshot', () => {
    const request = {};
    registerFrameworkSessionPrincipalSnapshot(request, {
      id: 'session_1',
      user: { id: 'principal_1' },
    });

    expect(scopedKeyFactsFor(scopedKey(request, 'avatars/current.png'))).toMatchObject({
      authority: 'principal_1',
      key: 'avatars/current.png',
      posture: 'principal',
    });
  });

  it('rejects anonymous, unresolved, and app-created session-shaped carriers', () => {
    const anonymous = {};
    registerFrameworkSessionPrincipalSnapshot(anonymous, null);
    const unresolved = {};
    registerFrameworkSessionPrincipalSnapshot(unresolved, { user: { id: 'anonymous' } });

    expect(() => scopedKey(anonymous, 'k')).toThrow(/framework-resolved principal/u);
    expect(() => scopedKey(unresolved, 'k')).toThrow(/framework-resolved principal/u);
    expect(() => scopedKey({ session: { user: { id: 'forged-principal' } } }, 'k')).toThrow(
      /framework-owned session request carrier/u,
    );
  });
});
