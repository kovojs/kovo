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
  type BetterAuthApiUsage,
  type BetterAuthRequestSecretPath,
  type BetterAuthRequestReachableExport,
} from './internal/non-egress-proof.js';
import {
  betterAuthCredentialConsumerContracts,
  betterAuthCredentialConsumers,
  consumeBetterAuthCredentialResult,
  isBetterAuthCredentialGateFailure,
  runBetterAuthCredentialConsumer,
  runBetterAuthCredentialConsumerAsync,
} from './internal/credential-runtime-gate.js';

const srcDir = new URL('.', import.meta.url).pathname;
const trustedPlaintextModule = 'internal/trusted-plaintext.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (!entry.endsWith('.ts')) return [];
    if (entry.endsWith('.test.ts') || basename(entry) === 'test-fakes.ts') return [];
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

function scanBetterAuthRawCredentialConsumers(): Array<{ consumer: string; file: string }> {
  const uses: Array<{ consumer: string; file: string }> = [];
  for (const path of sourceFiles(srcDir)) {
    const file = relative(srcDir, path).split('\\').join('/');
    if (file === 'internal/credential-runtime-gate.ts') continue;
    const sourceFile = ts.createSourceFile(file, sourceText(file), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sourceFile);
        const firstArgument = node.arguments[0]?.getText(sourceFile);
        let consumer: string | undefined;
        if (
          callee === 'betterAuth' ||
          callee === 'createBetterAuthPostgresRateLimitStorage' ||
          callee === 'createBetterAuthSqliteRateLimitStorage' ||
          callee === 'pinnedKovoHashPassword' ||
          callee === 'pinnedKovoVerifyPassword' ||
          callee === 'sanitizeBetterAuthSessionPayload' ||
          callee === 'snapshotBetterAuthSetCookie'
        ) {
          consumer = callee;
        } else if (callee === 'betterAuthApply' && firstArgument?.endsWith('.handler')) {
          consumer = 'Better Auth handler';
        } else {
          const api = /\.api\.([A-Za-z0-9_$]+)$/u.exec(callee)?.[1];
          if (api !== undefined) consumer = `auth.api.${api}`;
        }
        if (consumer !== undefined) uses.push({ consumer, file });
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return uses.sort((left, right) =>
    `${left.file}:${left.consumer}`.localeCompare(`${right.file}:${right.consumer}`),
  );
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

  it('keeps the raw Better Auth credential-consumer denominator equal to the reviewed census', () => {
    expect(scanBetterAuthRawCredentialConsumers()).toEqual(
      [
        { consumer: 'pinnedKovoHashPassword', file: 'internal/password.ts' },
        { consumer: 'pinnedKovoVerifyPassword', file: 'internal/password.ts' },
        { consumer: 'Better Auth handler', file: 'internal/trusted-plaintext.ts' },
        { consumer: 'auth.api.getSession', file: 'internal/trusted-plaintext.ts' },
        { consumer: 'auth.api.signOut', file: 'internal/trusted-plaintext.ts' },
        { consumer: 'auth.api.signUpEmail', file: 'internal/trusted-plaintext.ts' },
        { consumer: 'snapshotBetterAuthSetCookie', file: 'internal/trusted-plaintext.ts' },
        { consumer: 'Better Auth handler', file: 'mount-adapter.ts' },
        { consumer: 'betterAuth', file: 'postgres.ts' },
        {
          consumer: 'createBetterAuthPostgresRateLimitStorage',
          file: 'postgres.ts',
        },
        { consumer: 'sanitizeBetterAuthSessionPayload', file: 'session.ts' },
        { consumer: 'betterAuth', file: 'sqlite.ts' },
        {
          consumer: 'createBetterAuthSqliteRateLimitStorage',
          file: 'sqlite.ts',
        },
      ].sort((left, right) =>
        `${left.file}:${left.consumer}`.localeCompare(`${right.file}:${right.consumer}`),
      ),
    );
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

    const verify = betterAuthCredentialConsumers.passwordVerify;
    const result = runBetterAuthCredentialConsumer(verify, () => true);
    expect(() =>
      consumeBetterAuthCredentialResult(
        betterAuthCredentialConsumers.passwordHash as never,
        result as never,
      ),
    ).toThrow('KV439: mismatched Better Auth credential consumer result');
    expect(consumeBetterAuthCredentialResult(verify, result)).toBe(true);
    expect(() => consumeBetterAuthCredentialResult(verify, result)).toThrow(
      'KV439: mismatched Better Auth credential consumer result',
    );
  });

  it('validates hostile consumer results and redacts provider errors at runtime', async () => {
    const password = 'M2_PASSWORD_MUST_NOT_LEAVE_THE_GATE';
    await expect(
      runBetterAuthCredentialConsumerAsync(
        betterAuthCredentialConsumers.passwordHash,
        async () => password,
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
      runBetterAuthCredentialConsumer(
        betterAuthCredentialConsumers.credentialCookieForwarding,
        () => proxyResult,
      ),
    ).toThrow('returned a Proxy');
    expect(resultTrapRan).toBe(false);

    const providerError = Object.assign(new Error(`provider reflected ${password}`), {
      status: 401,
    });
    let caught: unknown;
    try {
      await runBetterAuthCredentialConsumerAsync(
        betterAuthCredentialConsumers.credentialHandlerSignInEmail,
        async () => {
          throw providerError;
        },
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
      await runBetterAuthCredentialConsumerAsync(
        betterAuthCredentialConsumers.credentialHandlerSignInEmail,
        async () => {
          throw accessorError;
        },
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
      await runBetterAuthCredentialConsumerAsync(
        betterAuthCredentialConsumers.credentialHandlerSignInEmail,
        async () => {
          throw proxyError;
        },
      );
    } catch (error) {
      proxyCaught = error;
    }
    expect(String(proxyCaught)).not.toContain(password);
    expect(isBetterAuthCredentialGateFailure(proxyCaught)).toBe(false);
  });

  // SPEC §10.1 C10 / §6.6 (papercuts-36 P1): confinement is a FAIL-CLOSED enumeration whose
  // completeness is checked against the actual `auth.api.*` surface Kovo calls, not a hardcoded
  // 4-name regex. A new plaintext-reading endpoint used outside the trusted module — or any
  // unclassified `auth.api.*` usage — turns the proof RED until it is classified.
  function scanBetterAuthApiUsages(): BetterAuthApiUsage[] {
    const apiCall = /\bauth\.api\.([A-Za-z0-9_$]+)\s*\(/g;
    return sourceFiles(srcDir).flatMap((path) => {
      const rel = relative(srcDir, path).split('\\').join('/');
      return [...sourceWithoutComments(rel).matchAll(apiCall)].map((match) => ({
        method: match[1] as string,
        file: rel,
      }));
    });
  }

  it('confines the enumerated Better Auth plaintext API surface to the trusted module', () => {
    const usages = scanBetterAuthApiUsages();

    // The real framework surface is fully classified and confined (proof is GREEN).
    expect(proveBetterAuthPlaintextApiConfinement(usages)).toEqual([]);
    expect(usages).toHaveLength(3);

    // Every `auth.api.*` Kovo calls today reads plaintext and lives in the trusted module.
    expect(new Set(usages.map((usage) => usage.file))).toEqual(
      new Set([betterAuthTrustedPlaintextModule]),
    );
    expect([...new Set(usages.map((usage) => usage.method))].sort()).toEqual([
      'getSession',
      'signOut',
      'signUpEmail',
    ]);
    for (const method of ['getSession', 'signInEmail', 'signOut', 'signUpEmail']) {
      expect(betterAuthPlaintextReadingApiMethods).toContain(method);
    }
  });

  it('fails red when a new plaintext-reading auth.api.* usage escapes the trusted module', () => {
    const usages = scanBetterAuthApiUsages();

    // A known plaintext endpoint (resetPassword) invoked outside the trusted module is MISPLACED.
    expect(
      proveBetterAuthPlaintextApiConfinement([
        ...usages,
        { method: 'resetPassword', file: 'mutations.ts' },
      ]),
    ).toEqual([
      `KV439: plaintext-reading Better Auth API auth.api.resetPassword used outside ` +
        `${betterAuthTrustedPlaintextModule} in mutations.ts`,
    ]);
  });

  it('fails red when an unclassified auth.api.* method appears in framework source', () => {
    const usages = scanBetterAuthApiUsages();

    // A brand-new endpoint Kovo has never classified fails closed until it is enumerated.
    expect(
      proveBetterAuthPlaintextApiConfinement([
        ...usages,
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
