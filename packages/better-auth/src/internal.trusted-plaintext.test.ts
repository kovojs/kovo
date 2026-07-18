import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  assertBetterAuthRequestSecretPath,
  betterAuthNonPlaintextApiMethods,
  betterAuthPlaintextReadingApiMethods,
  betterAuthRequestSecretPaths,
  betterAuthTrustedPlaintextModule,
  proveBetterAuthPlaintextApiConfinement,
  proveBetterAuthRequestSecretNonEgress,
  proveBetterAuthRequestExportConfinement,
  type BetterAuthRequestSecretPath,
  type BetterAuthRequestReachableExport,
} from './internal/non-egress-proof.js';
import {
  betterAuthCredentialConsumerContracts,
  betterAuthCredentialConsumers,
  consumeBetterAuthCredentialResult,
  isBetterAuthCredentialGateFailure,
  runBetterAuthCredentialConsumer,
  runBetterAuthCredentialSourceCallable,
  runBetterAuthCredentialSourceCallableAsync,
} from './internal/credential-runtime-gate.js';
import { censusBetterAuthCredentialSources } from './internal/credential-source-census.test-helper.js';

const srcDir = new URL('.', import.meta.url).pathname;
const trustedPlaintextModule = 'internal/trusted-plaintext.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (!entry.endsWith('.ts')) return [];
    if (
      entry.endsWith('.test.ts') ||
      entry.endsWith('.test-helper.ts') ||
      basename(entry) === 'test-fakes.ts'
    ) {
      return [];
    }
    return [path];
  });
}

function sourceText(relativePath: string): string {
  return readFileSync(join(srcDir, relativePath), 'utf8');
}

function sourceWithoutComments(relativePath: string): string {
  return sourceText(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function generatedAuthRuntimeExports(source: string): BetterAuthRequestReachableExport[] {
  const sourceFile = ts.createSourceFile('src/auth.ts', source, ts.ScriptTarget.Latest, true);
  const facts: BetterAuthRequestReachableExport[] = [];

  for (const statement of sourceFile.statements) {
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        facts.push(
          classifyGeneratedAuthExport(declaration.name.text, statement.getText(sourceFile)),
        );
      }
      continue;
    }
    if (
      exported &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      facts.push(classifyGeneratedAuthExport(statement.name.text, statement.getText(sourceFile)));
      continue;
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        facts.push(classifyGeneratedAuthExport(element.name.text, element.getText(sourceFile)));
      }
    }
  }

  return facts.sort((left, right) => left.name.localeCompare(right.name));
}

function classifyGeneratedAuthExport(
  name: string,
  source: string,
): BetterAuthRequestReachableExport {
  if (
    /\bcreateAuthAdapter\b|\bauth\.\$context\b|\bauth\.api\b|\bauthBindings\.\$context\b|\b\.adapter\b/.test(
      source,
    ) ||
    (/\bcreateAppAuthBindings\b/.test(source) && !/\bauthBindings\b/.test(source))
  ) {
    return { capability: 'privileged-adapter', name };
  }

  const members = [
    ...source.matchAll(/\bauthBindings\.(seedDemoUser|sessionProvider|signIn|signOut)\b/g),
  ].map((match) => match[1]);
  if (/\bauthBindings\b/.test(source) && members.length === 0) {
    return { capability: 'unclassified', name };
  }
  if (members.includes('sessionProvider')) {
    return { capability: 'sanitized-session-provider', name };
  }
  if (members.includes('signIn') || members.includes('signOut')) {
    return { capability: 'credential-mutation', name };
  }
  if (members.includes('seedDemoUser')) {
    return { capability: 'fixed-seed-operation', name };
  }
  return { capability: 'app-owned-declaration', name };
}

describe('Better Auth trusted plaintext zone', () => {
  it('proves every actual generated auth export is capability-clean in both dialects', () => {
    const expectedNames = [
      'appAuthed',
      'appCsrf',
      'appSession',
      'appSessionProvider',
      'appSignIn',
      'appSignOut',
    ];
    for (const template of [
      '../../create-kovo/templates/src/auth.ts',
      '../../create-kovo/templates/src/auth.sqlite.ts',
    ]) {
      const exports = generatedAuthRuntimeExports(readFileSync(join(srcDir, template), 'utf8'));
      expect(exports.map((exported) => exported.name)).toEqual(expectedNames);
      expect(proveBetterAuthRequestExportConfinement(exports)).toEqual([]);
    }

    expect(
      proveBetterAuthRequestExportConfinement([
        { capability: 'privileged-adapter', name: 'leakedAdapter' },
        { capability: 'raw-auth-instance', name: 'auth' },
        { capability: 'unclassified', name: 'futureAuthHelper' },
      ]),
    ).toEqual([
      'KV439: request-reachable Better Auth export leakedAdapter exposes privileged-adapter',
      'KV439: request-reachable Better Auth export auth exposes raw-auth-instance',
      'KV439: request-reachable Better Auth export futureAuthHelper exposes unclassified',
    ]);
  });

  it('proves the request-reachable auth secret surface instead of a proxy module name', () => {
    expect(proveBetterAuthRequestSecretNonEgress()).toEqual([]);

    expect(betterAuthRequestSecretPaths.map((path) => path.id)).toEqual([
      'better-auth.sign-in.submitted-password',
      'better-auth.sign-up.submitted-password',
      'better-auth.sign-out.request-cookie',
      'better-auth.get-session.request-cookie',
      'better-auth.get-session.response-secret-projection',
      'better-auth.set-cookie.forwarding',
      'better-auth.session-refresh.set-cookie',
      'better-auth.adapter.sign-in.account-password',
      'better-auth.adapter.session-token-lookup',
      'better-auth.mount.handler-delegation',
      'better-auth.mount.set-cookie-forwarding',
      'better-auth.binding.signing-secret',
      'better-auth.rate-limit.signing-secret',
    ]);

    expect(
      new Set(
        betterAuthRequestSecretPaths
          .filter((path) => path.carrier === 'adapter-system-db-secret-column')
          .map((path) => path.id),
      ),
    ).toEqual(
      new Set([
        'better-auth.get-session.response-secret-projection',
        'better-auth.adapter.sign-in.account-password',
        'better-auth.adapter.session-token-lookup',
      ]),
    );
  });

  it('seals the exported proof inventories against late posture erasure', () => {
    // SPEC §10.3 C9-C10: the public audit view must stay identical to the private proof snapshot.
    // A consumer of the internal subpath must not be able to publish an empty manifest after boot.
    const secretLength = betterAuthRequestSecretPaths.length;
    const plaintextLength = betterAuthPlaintextReadingApiMethods.length;
    const nonPlaintextLength = betterAuthNonPlaintextApiMethods.length;
    let secretMutated = false;
    let plaintextMutated = false;
    let nonPlaintextMutated = false;
    try {
      secretMutated = Reflect.set(betterAuthRequestSecretPaths, 'length', 0);
      plaintextMutated = Reflect.set(betterAuthPlaintextReadingApiMethods, 'length', 0);
      nonPlaintextMutated = Reflect.set(betterAuthNonPlaintextApiMethods, 'length', 1);
      expect([secretMutated, plaintextMutated, nonPlaintextMutated]).toEqual([false, false, false]);
    } finally {
      if (secretMutated) Reflect.set(betterAuthRequestSecretPaths, 'length', secretLength);
      if (plaintextMutated)
        Reflect.set(betterAuthPlaintextReadingApiMethods, 'length', plaintextLength);
      if (nonPlaintextMutated)
        Reflect.set(betterAuthNonPlaintextApiMethods, 'length', nonPlaintextLength);
    }
  });

  it('keeps the TCB enrollment path list equal to the executable manifest', () => {
    const tcbSource = readFileSync(join(srcDir, '../../../security/TCB.md'), 'utf8');
    const manifestBlock = /```json tcb-manifest\s+([\s\S]*?)```/u.exec(tcbSource)?.[1];
    if (manifestBlock === undefined) throw new Error('Missing TCB manifest block');
    const manifest = JSON.parse(manifestBlock) as {
      entries: Array<{ id: string; paths?: string[] }>;
    };
    const enrolled = manifest.entries.find(
      (entry) => entry.id === 'better-auth.request-secret-surface.manifest',
    );

    expect(enrolled?.paths).toEqual(betterAuthRequestSecretPaths.map((path) => path.id));
  });

  it('fails red when a new request-reachable adapter path reads an unboxed cross-user credential', () => {
    const unsafePath: BetterAuthRequestSecretPath = {
      id: 'better-auth.adapter.future-token-leak',
      entrypoint: 'session-provider',
      carrier: 'adapter-system-db-secret-column',
      source: 'better-auth Drizzle adapter systemDb handle',
      disposition: 'confined-third-party-adapter',
      readsCrossUserCredential: true,
      reason: 'synthetic regression path',
    };

    expect(
      proveBetterAuthRequestSecretNonEgress([...betterAuthRequestSecretPaths, unsafePath]),
    ).toEqual([
      'KV439: better-auth.adapter.future-token-leak reads a cross-user auth credential with unboxed disposition confined-third-party-adapter',
    ]);
  });

  it('fails red when an adapter credential path is neither confined nor reconstructed', () => {
    const unsafePath: BetterAuthRequestSecretPath = {
      id: 'better-auth.adapter.current-session-leak',
      entrypoint: 'session-provider',
      carrier: 'adapter-system-db-secret-column',
      source: 'packages/better-auth/src/session.ts',
      disposition: 'confined-third-party-adapter',
      readsCrossUserCredential: false,
      reason: 'synthetic regression path',
    };

    expect(proveBetterAuthRequestSecretNonEgress([unsafePath])).toEqual([
      'KV439: better-auth.adapter.current-session-leak handles an adapter auth credential with unconfined disposition confined-third-party-adapter',
    ]);
  });

  it('keeps the runtime secret-path gate closed after late Set poisoning', () => {
    // SPEC §6.6/§10.3 C9-C10: the plaintext boundary cannot delegate its allowlist
    // decision to mutable ambient Set methods. A request-reachable app can poison those methods
    // after boot; an unenumerated path must still be rejected.
    const originalHas = Set.prototype.has;
    let rejected = false;
    try {
      Set.prototype.has = () => true;
      try {
        assertBetterAuthRequestSecretPath('better-auth.unreviewed.secret-path' as never);
      } catch {
        rejected = true;
      }
    } finally {
      Set.prototype.has = originalHas;
    }

    expect(rejected).toBe(true);
  });

  it('keeps every proof oracle red after late Array iterator poisoning', () => {
    // rules/security-classifier-refactors.md C13: proof classifiers must preserve their closed
    // verdicts under a hostile realm. `for ... of` over caller arrays is ambient iterator
    // authority and previously let every hostile fact disappear from the proof.
    const originalIterator = Array.prototype[Symbol.iterator];
    let exportIssues: string[];
    let plaintextIssues: string[];
    let secretIssues: string[];
    try {
      Array.prototype[Symbol.iterator] = function () {
        return {
          next: () => ({ done: true, value: undefined }),
        } as ArrayIterator<unknown>;
      };
      exportIssues = proveBetterAuthRequestExportConfinement([
        { capability: 'raw-auth-instance', name: 'auth' },
      ]);
      plaintextIssues = proveBetterAuthPlaintextApiConfinement([
        { file: 'session.ts', method: 'futureSecretApi' },
      ]);
      secretIssues = proveBetterAuthRequestSecretNonEgress([
        {
          carrier: 'adapter-system-db-secret-column',
          disposition: 'confined-third-party-adapter',
          entrypoint: 'session-provider',
          id: 'better-auth.adapter.future-token-leak',
          readsCrossUserCredential: true,
          reason: 'synthetic regression path',
          source: 'better-auth Drizzle adapter systemDb handle',
        },
      ]);
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    expect(exportIssues!).toEqual([
      'KV439: request-reachable Better Auth export auth exposes raw-auth-instance',
    ]);
    expect(plaintextIssues!).toEqual([
      `KV439: unclassified Better Auth plaintext API auth.api.futureSecretApi in session.ts; ` +
        `classify it as plaintext-reading (confined to ${betterAuthTrustedPlaintextModule}) or ` +
        `allowlist it as non-plaintext with justification`,
    ]);
    expect(secretIssues!).toEqual([
      'KV439: better-auth.adapter.future-token-leak reads a cross-user auth credential with unboxed disposition confined-third-party-adapter',
    ]);
  });

  it('binds every M2 secret path to at least one exact runtime consumer', () => {
    const asserted = betterAuthCredentialConsumerContracts.flatMap((contract) => contract.paths);
    const manifestIds = new Set(betterAuthRequestSecretPaths.map((path) => path.id));
    const assertedIds = new Set(asserted);

    expect([...assertedIds].sort()).toEqual([...manifestIds].sort());
    expect(asserted.every((id) => manifestIds.has(id))).toBe(true);
    const consumerTokens = Object.values(betterAuthCredentialConsumers);
    expect(consumerTokens).toHaveLength(betterAuthCredentialConsumerContracts.length);
    expect(new Set(consumerTokens).size).toBe(consumerTokens.length);
    expect(Object.keys(betterAuthCredentialConsumers).sort()).toEqual(
      betterAuthCredentialConsumerContracts.map((contract) => contract.token).sort(),
    );
  });

  it('routes every declared runtime consumer through its sole registered owner', () => {
    // SPEC §6.6/§10.3 C9-C10: the unique-symbol type is ergonomics only. This source census binds
    // every actual token use to the contract owner, while runtime registry tests below prove that
    // structural forgeries cannot enter or leave the door.
    const gateModule = 'internal/credential-runtime-gate.ts';
    const consumerUse = /\bbetterAuthCredentialConsumers\.([A-Za-z0-9_$]+)/g;
    const uses = sourceFiles(srcDir)
      .filter((path) => relative(srcDir, path).split('\\').join('/') !== gateModule)
      .flatMap((path) => {
        const file = relative(srcDir, path).split('\\').join('/');
        return [...sourceWithoutComments(file).matchAll(consumerUse)].map((match) => ({
          file,
          name: match[1],
        }));
      });

    expect(uses).toHaveLength(16);
    expect(uses).toEqual(
      expect.arrayContaining([
        { file: 'internal/password.ts', name: 'passwordHash' },
        { file: 'internal/password.ts', name: 'passwordVerify' },
        { file: 'internal/trusted-plaintext.ts', name: 'credentialHandlerSignInEmail' },
        { file: 'internal/trusted-plaintext.ts', name: 'credentialHandlerSignUpEmail' },
        { file: 'internal/trusted-plaintext.ts', name: 'seedSignUpEmail' },
        { file: 'internal/trusted-plaintext.ts', name: 'signOut' },
        { file: 'internal/trusted-plaintext.ts', name: 'getSession' },
        { file: 'internal/trusted-plaintext.ts', name: 'credentialCookieForwarding' },
        { file: 'internal/trusted-plaintext.ts', name: 'sessionCookieForwarding' },
        { file: 'internal/trusted-plaintext.ts', name: 'mountCookieForwarding' },
        { file: 'mount-adapter.ts', name: 'mountHandler' },
        { file: 'postgres.ts', name: 'postgresRateLimit' },
        { file: 'postgres.ts', name: 'postgresAdapter' },
        { file: 'session.ts', name: 'sessionProjection' },
        { file: 'sqlite.ts', name: 'sqliteRateLimit' },
        { file: 'sqlite.ts', name: 'sqliteAdapter' },
      ]),
    );
  });

  it('keeps the symbol-flow Better Auth credential denominator equal to the reviewed census', () => {
    // SPEC §6.6/§10.3 C9-C10: this is the complete source-use closure, not a printed-name regex.
    // Every raw dependency/secret transform is dominated by the exact gate callback, and its
    // consumer token, owner module, and raw-source class agree with the runtime contract ledger.
    const census = censusBetterAuthCredentialSources(
      sourceFiles(srcDir).map((path) => {
        const file = relative(srcDir, path).split('\\').join('/');
        return { file, source: sourceText(file) };
      }),
    );
    expect(census.issues).toEqual([]);

    const contractsByToken = new Map(
      betterAuthCredentialConsumerContracts.map((contract) => [contract.token, contract]),
    );
    const observed = new Set(
      census.invocations.flatMap((invocation) =>
        invocation.consumers.map((token) => {
          const contract = contractsByToken.get(token);
          if (contract === undefined) {
            return `UNREGISTERED:${invocation.file}:${token}:${invocation.source}`;
          }
          return `${invocation.file}:${contract.id}:${invocation.source}`;
        }),
      ),
    );
    const expected = new Set(
      betterAuthCredentialConsumerContracts.map(
        (contract) => `${contract.owner}:${contract.id}:${contract.source}`,
      ),
    );
    expect([...observed].sort()).toEqual([...expected].sort());
  });

  it('fails red on aliased, destructured, computed, call/apply, and imported raw consumers', () => {
    const census = censusBetterAuthCredentialSources([
      {
        file: 'raw-authority.ts',
        source: `
          declare const auth: unknown;
          export const apiAlias = (auth as any)['api'];
          export const handlerAlias = (auth as any)['handler'];
        `,
      },
      {
        file: 'bypass.ts',
        source: `
          import { hashPassword as importedHashAlias } from '@kovojs/server';
          import { apiAlias as importedApi, handlerAlias as importedHandler } from './raw-authority.js';
          const { ['getSession']: destructuredSession } = importedApi;
          destructuredSession.call(importedApi, { headers: new Headers() });
          Reflect.apply(importedHandler, null, [new Request('https://app.example/')]);
          importedHashAlias('M2_RAW_PASSWORD');
        `,
      },
    ]);

    expect(census.invocations).toEqual([]);
    expect(census.issues).toHaveLength(3);
    expect(census.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('raw Better Auth credential source better-auth.callable'),
        expect.stringContaining('raw Better Auth credential source password.hash'),
      ]),
    );
  });

  it('accepts gate/token aliases only when symbol flow still resolves the exact owner', () => {
    const census = censusBetterAuthCredentialSources([
      {
        file: 'internal/credential-runtime-gate.ts',
        source:
          'export declare const betterAuthCredentialConsumers: unknown; export declare function runBetterAuthCredentialSourceCallableAsync(...args: unknown[]): unknown;',
      },
      {
        file: 'owned.ts',
        source: `
          import { hashPassword as importedHashAlias } from '@kovojs/server';
          import {
            betterAuthCredentialConsumers as tokenRegistryAlias,
            runBetterAuthCredentialSourceCallableAsync as runGateAlias,
          } from './internal/credential-runtime-gate.js';
          const { ['passwordHash']: exactOwnerAlias } = tokenRegistryAlias as any;
          runGateAlias(
            exactOwnerAlias,
            'password.hash',
            importedHashAlias,
            undefined,
            ['M2_REVIEWED_PASSWORD'],
          );
        `,
      },
    ]);

    expect(census.issues).toEqual([]);
    expect(census.invocations).toEqual([
      expect.objectContaining({
        consumers: ['passwordHash'],
        file: 'owned.ts',
        source: 'password.hash',
      }),
    ]);
  });

  it('rejects forged, cross-consumer, and replayed runtime results', () => {
    let invoked = false;
    expect(() =>
      runBetterAuthCredentialConsumer({} as never, () => {
        invoked = true;
        return true;
      }),
    ).toThrow('KV439: unregistered Better Auth credential consumer');
    expect(invoked).toBe(false);

    let externalCallbackInvoked = false;
    expect(() =>
      runBetterAuthCredentialConsumer(betterAuthCredentialConsumers.passwordVerify, () => {
        externalCallbackInvoked = true;
        return true;
      }),
    ).toThrow('cannot execute an owner callback');
    expect(externalCallbackInvoked).toBe(false);

    const projection = betterAuthCredentialConsumers.sessionProjection;
    const result = runBetterAuthCredentialConsumer(projection, () => ({
      session: {},
      user: {},
    }));
    expect(() =>
      consumeBetterAuthCredentialResult(
        betterAuthCredentialConsumers.getSession as never,
        result as never,
      ),
    ).toThrow('KV439: mismatched Better Auth credential consumer result');
    expect(consumeBetterAuthCredentialResult(projection, result)).toEqual({
      session: {},
      user: {},
    });
    expect(() => consumeBetterAuthCredentialResult(projection, result)).toThrow(
      'KV439: mismatched Better Auth credential consumer result',
    );
  });

  it('keeps raw Better Auth callables inside the exact runtime door', async () => {
    const consumer = betterAuthCredentialConsumers.credentialHandlerSignInEmail;
    const receiver = Object.freeze({ id: 'exact-better-auth-receiver' });
    let seenReceiver: unknown;
    let seenArgument: unknown;
    const sealed = await runBetterAuthCredentialSourceCallableAsync<Response>(
      consumer,
      'better-auth.callable',
      function (this: unknown, argument: unknown) {
        seenReceiver = this;
        seenArgument = argument;
        return new Response(null, { status: 204 });
      },
      receiver,
      ['M2_REVIEWED_ARGUMENT'],
    );
    expect(seenReceiver).toBe(receiver);
    expect(seenArgument).toBe('M2_REVIEWED_ARGUMENT');
    expect(consumeBetterAuthCredentialResult(consumer, sealed).status).toBe(204);

    let wrongSourceInvoked = false;
    await expect(
      runBetterAuthCredentialSourceCallableAsync(
        betterAuthCredentialConsumers.passwordHash,
        'better-auth.callable',
        () => {
          wrongSourceInvoked = true;
          return new Response();
        },
        receiver,
        [],
      ),
    ).rejects.toThrow('cannot invoke raw source better-auth.callable');
    expect(wrongSourceInvoked).toBe(false);

    let proxyInvoked = false;
    const proxyMethod = new Proxy(() => {
      proxyInvoked = true;
      return new Response();
    }, {});
    await expect(
      runBetterAuthCredentialSourceCallableAsync(
        consumer,
        'better-auth.callable',
        proxyMethod,
        receiver,
        [],
      ),
    ).rejects.toThrow('received an invalid callable');
    expect(proxyInvoked).toBe(false);

    const password = 'M2_CALLABLE_ERROR_MUST_NOT_EGRESS';
    let caught: unknown;
    try {
      await runBetterAuthCredentialSourceCallableAsync(
        consumer,
        'better-auth.callable',
        () => {
          throw Object.assign(new Error(password), { status: 401 });
        },
        receiver,
        [],
      );
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).not.toContain(password);
    expect(isBetterAuthCredentialGateFailure(caught)).toBe(true);
    expect(isBetterAuthCredentialGateFailure(caught)).toBe(false);
  });

  it('validates hostile consumer results and redacts provider errors at runtime', async () => {
    const password = 'M2_PASSWORD_MUST_NOT_LEAVE_THE_GATE';
    await expect(
      runBetterAuthCredentialSourceCallableAsync<string>(
        betterAuthCredentialConsumers.passwordHash,
        'password.hash',
        async () => password,
        undefined,
        [],
      ),
    ).rejects.toThrow('returned a non-Argon2id hash');

    let resultTrapRan = false;
    const proxyResult = new Proxy([] as string[], {
      getOwnPropertyDescriptor() {
        resultTrapRan = true;
        throw new Error(`proxy result reflected ${password}`);
      },
    });
    expect(() =>
      runBetterAuthCredentialSourceCallable<string[]>(
        betterAuthCredentialConsumers.credentialCookieForwarding,
        'cookie.snapshot',
        () => proxyResult,
        undefined,
        [],
      ),
    ).toThrow('returned a Proxy');
    expect(resultTrapRan).toBe(false);

    const providerError = Object.assign(new Error(`provider reflected ${password}`), {
      status: 401,
    });
    let caught: unknown;
    try {
      await runBetterAuthCredentialSourceCallableAsync(
        betterAuthCredentialConsumers.credentialHandlerSignInEmail,
        'better-auth.callable',
        async () => {
          throw providerError;
        },
        Object.freeze({}),
        [],
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(password);
    expect(isBetterAuthCredentialGateFailure(caught)).toBe(true);
    expect(isBetterAuthCredentialGateFailure(caught)).toBe(false);

    let getterRan = false;
    const accessorError = new Error(`provider reflected ${password}`);
    Object.defineProperty(accessorError, 'status', {
      get() {
        getterRan = true;
        return 401;
      },
    });
    let accessorCaught: unknown;
    try {
      await runBetterAuthCredentialSourceCallableAsync(
        betterAuthCredentialConsumers.credentialHandlerSignInEmail,
        'better-auth.callable',
        async () => {
          throw accessorError;
        },
        Object.freeze({}),
        [],
      );
    } catch (error) {
      accessorCaught = error;
    }
    expect(getterRan).toBe(false);
    expect(String(accessorCaught)).not.toContain(password);
    expect(isBetterAuthCredentialGateFailure(accessorCaught)).toBe(false);

    const proxyError = new Proxy(Object.create(null), {
      getOwnPropertyDescriptor() {
        throw new Error(`proxy trap reflected ${password}`);
      },
    });
    let proxyCaught: unknown;
    try {
      await runBetterAuthCredentialSourceCallableAsync(
        betterAuthCredentialConsumers.credentialHandlerSignInEmail,
        'better-auth.callable',
        async () => {
          throw proxyError;
        },
        Object.freeze({}),
        [],
      );
    } catch (error) {
      proxyCaught = error;
    }
    expect(String(proxyCaught)).not.toContain(password);
    expect(isBetterAuthCredentialGateFailure(proxyCaught)).toBe(false);
  });

  // SPEC §10.1 C10 / §6.6: raw `auth.api.*` call syntax has been eliminated. The symbol-flow
  // census above now owns completeness across aliases and invocation forms; this classifier keeps
  // the closed verdict vocabulary for any future reviewed API operation.
  it('keeps raw Better Auth API calls absent behind captured gate-owned callables', () => {
    expect(proveBetterAuthPlaintextApiConfinement([])).toEqual([]);
    for (const method of ['getSession', 'signInEmail', 'signOut', 'signUpEmail']) {
      expect(betterAuthPlaintextReadingApiMethods).toContain(method);
    }
  });

  it('fails red when a new plaintext-reading auth.api.* usage escapes the trusted module', () => {
    // A known plaintext endpoint (resetPassword) invoked outside the trusted module is MISPLACED.
    expect(
      proveBetterAuthPlaintextApiConfinement([{ method: 'resetPassword', file: 'mutations.ts' }]),
    ).toEqual([
      `KV439: plaintext-reading Better Auth API auth.api.resetPassword used outside ` +
        `${betterAuthTrustedPlaintextModule} in mutations.ts`,
    ]);
  });

  it('fails red when an unclassified auth.api.* method appears in framework source', () => {
    // A brand-new endpoint Kovo has never classified fails closed until it is enumerated.
    expect(
      proveBetterAuthPlaintextApiConfinement([
        { method: 'signInWithFutureCredential', file: 'session.ts' },
      ]),
    ).toEqual([
      `KV439: unclassified Better Auth plaintext API auth.api.signInWithFutureCredential in ` +
        `session.ts; classify it as plaintext-reading (confined to ` +
        `${betterAuthTrustedPlaintextModule}) or allowlist it as non-plaintext with justification`,
    ]);
  });

  it('keeps the trusted module free of log, error, response, header, and network egress sinks', () => {
    const source = sourceText(trustedPlaintextModule);
    const forbidden = [
      /\bconsole\./,
      /\bthrow\b/,
      /\bnew\s+Error\b/,
      /\bnew\s+Response\b/,
      /\bResponse\.json\b/,
      /\bfetch\s*\(/,
      /\bJSON\.stringify\s*\(/,
      /\bheaders\.(?:append|delete|set)\s*\(/i,
    ];

    for (const pattern of forbidden) {
      expect(source, `forbidden trusted-plaintext sink ${pattern}`).not.toMatch(pattern);
    }
  });

  it('allows extracted Set-Cookie plaintext only at session-cookie sinks', () => {
    const setCookieCall = /\bgetBetterAuthSetCookie\s*\(/g;
    const matches = sourceFiles(srcDir).flatMap((path) => {
      const rel = relative(srcDir, path);
      return [...sourceWithoutComments(rel).matchAll(setCookieCall)].map(
        (match) => `${rel}:${match[0]}`,
      );
    });

    expect(new Set(matches.map((match) => match.slice(0, match.indexOf(':'))))).toEqual(
      new Set(['internal/credential.ts', 'internal/trusted-plaintext.ts']),
    );
    expect(sourceText('internal/credential.ts')).toContain('forward(cookie,');
    expect(sourceText('mount-adapter.ts')).toContain('getBetterAuthMountSetCookie(headers)');
    expect(sourceText('session.ts')).toContain('setCookies.length > 0 ? { setCookies, value }');
  });
});
