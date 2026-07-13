import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  actAsNonRequestPrincipal,
  assertNonRequestPrincipalPosture,
  declareSystemPrincipal,
  frameworkSessionPrincipalPostureFromRequest,
  inheritFrameworkPrincipalSnapshot,
  nonRequestPrincipalPostureDiagnostic,
  principalPostureFromRequest,
  principalFromNonRequestPrincipalPosture,
  registerFrameworkSessionPrincipalSnapshot,
  requestPrincipalSnapshot,
} from './auth-principal.js';

const authPrincipalModuleUrl = new URL('./auth-principal.ts', import.meta.url).href;

describe('request principal posture (SPEC §6.5/§6.6)', () => {
  it('accepts only stable own session/user/id data and snapshots roles', () => {
    const request = {
      session: { id: 'session_1', user: { id: 'user_1', roles: ['member', 'admin'] } },
    };

    expect(principalPostureFromRequest(request)).toEqual({
      kind: 'proven',
      principal: 'user_1',
    });
    expect(requestPrincipalSnapshot(request)).toMatchObject({
      kind: 'proven',
      principal: 'user_1',
      rateLimitKey: 'session:session_1',
      roles: ['member', 'admin'],
    });
  });

  it('ignores inherited session, user, id, roles, and sessionId authority', () => {
    const inheritedSession = Object.create({
      session: { user: { id: 'attacker', roles: ['admin'] } },
      sessionId: 'attacker-session',
    });
    const inheritedUser = {
      session: Object.create({ user: { id: 'attacker', roles: ['admin'] } }),
    };
    const inheritedId = {
      session: { user: Object.create({ id: 'attacker', roles: ['admin'] }) },
    };
    const userWithInheritedRoles = Object.create({ roles: ['admin'] }) as {
      id?: string;
      roles?: readonly string[];
    };
    Object.defineProperty(userWithInheritedRoles, 'id', { value: 'user_1' });

    expect(principalPostureFromRequest(inheritedSession)).toEqual({ kind: 'anonymous' });
    expect(requestPrincipalSnapshot(inheritedSession).rateLimitKey).toBeUndefined();
    expect(principalPostureFromRequest(inheritedUser)).toEqual({ kind: 'unresolved' });
    expect(principalPostureFromRequest(inheritedId)).toEqual({ kind: 'unresolved' });
    expect(requestPrincipalSnapshot({ session: { user: userWithInheritedRoles } })).toMatchObject({
      kind: 'proven',
      principal: 'user_1',
      roles: undefined,
    });
  });

  it('rejects accessor and unregistered Proxy ambiguity without invoking getters', () => {
    let sessionReads = 0;
    const accessorRequest = {};
    Object.defineProperty(accessorRequest, 'session', {
      get() {
        sessionReads += 1;
        return { user: { id: 'attacker', roles: ['admin'] } };
      },
    });
    const proxyRequest = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, property) {
          return property === 'session'
            ? {
                configurable: true,
                enumerable: true,
                value: { user: { id: 'attacker', roles: ['admin'] } },
                writable: true,
              }
            : undefined;
        },
      },
    );
    const proxyUser = new Proxy({ id: 'attacker', roles: ['admin'] }, {});

    expect(principalPostureFromRequest(accessorRequest)).toEqual({ kind: 'unresolved' });
    expect(sessionReads).toBe(0);
    expect(principalPostureFromRequest(proxyRequest)).toEqual({ kind: 'unresolved' });
    expect(principalPostureFromRequest({ session: { user: proxyUser } })).toEqual({
      kind: 'unresolved',
    });
    expect(
      requestPrincipalSnapshot({
        session: { user: { id: 'user_1', roles: new Proxy(['admin'], {}) } },
      }),
    ).toMatchObject({ kind: 'proven', principal: 'user_1', roles: undefined });
  });

  it('classifies once and never re-reads mutable caller session bytes', () => {
    const session = { user: { id: 'user_1', roles: ['member'] } };
    const request = { session };
    const snapshot = requestPrincipalSnapshot(request);

    session.user.id = 'attacker';
    session.user.roles[0] = 'admin';

    expect(requestPrincipalSnapshot(request)).toBe(snapshot);
    expect(snapshot).toMatchObject({
      kind: 'proven',
      principal: 'user_1',
      roles: ['member'],
    });
  });

  it('distinguishes and propagates framework-installed session principal evidence', () => {
    const classified = { session: { user: { id: 'classified-user' } } };
    const frameworkCarrier = {};
    const inheritedCarrier = {};

    expect(frameworkSessionPrincipalPostureFromRequest(classified)).toBeUndefined();
    registerFrameworkSessionPrincipalSnapshot(frameworkCarrier, {
      user: { id: 'framework-user' },
    });
    expect(frameworkSessionPrincipalPostureFromRequest(frameworkCarrier)).toEqual({
      kind: 'proven',
      principal: 'framework-user',
    });

    inheritFrameworkPrincipalSnapshot(inheritedCarrier, frameworkCarrier);
    expect(frameworkSessionPrincipalPostureFromRequest(inheritedCarrier)).toEqual({
      kind: 'proven',
      principal: 'framework-user',
    });
  });

  it('ignores prototype pollution that exists before auth controls initialize', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { registerHooks } = await import('node:module');
      const { fileURLToPath } = await import('node:url');
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
            const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
            if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      Object.defineProperty(Object.prototype, 'session', {
        configurable: true,
        value: { user: { id: 'attacker', roles: ['admin'] } },
      });
      Object.defineProperty(Object.prototype, 'sessionId', {
        configurable: true,
        value: 'attacker-session',
      });
      const auth = await import(${JSON.stringify(`${authPrincipalModuleUrl}?preimport-prototype-pollution`)});
      const posture = auth.principalPostureFromRequest(new Request('https://app.example/admin'));
      if (posture.kind === 'anonymous') process.exit(0);
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('non-request principal posture (SPEC §10.3 DEC-G)', () => {
  const audit = {
    ingress: 'task' as const,
    operation: 'read' as const,
    surface: 'nightly:test_job',
  };

  it('mints branded actAs and system postures for framework-owned task/webhook seams', () => {
    const actAs = actAsNonRequestPrincipal('user_1', audit);
    const system = declareSystemPrincipal('nightly analytics sweep', audit);

    expect(() => assertNonRequestPrincipalPosture(actAs)).not.toThrow();
    expect(() => assertNonRequestPrincipalPosture(system)).not.toThrow();
    expect(nonRequestPrincipalPostureDiagnostic(actAs)).toBe(
      'task:nightly:test_job:read:actAs(user_1)',
    );
    expect(nonRequestPrincipalPostureDiagnostic(system)).toBe(
      'task:nightly:test_job:read:system(nightly analytics sweep)',
    );
    expect(principalFromNonRequestPrincipalPosture(actAs)).toBe('user_1');
    expect(principalFromNonRequestPrincipalPosture(system)).toBeUndefined();
  });

  it('rejects structural brand shortcuts and unresolved actAs ids', () => {
    const forged = {
      audit,
      kind: 'act-as',
      principal: 'user_1',
    };

    expect(() => assertNonRequestPrincipalPosture(forged)).toThrow(/framework-minted actAs/);
    expect(() => principalFromNonRequestPrincipalPosture(forged)).toThrow(/framework-minted actAs/);
    expect(() => actAsNonRequestPrincipal(' anonymous ', audit)).toThrow(/proven/);
    expect(() => declareSystemPrincipal('', audit)).toThrow(/non-empty audit reason/);
  });
});
