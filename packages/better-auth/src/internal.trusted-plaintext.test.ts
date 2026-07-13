import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  assertBetterAuthRequestSecretPath,
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
      'seedDemoUser',
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

  it('binds request-reachable plaintext assertions to the enumerated secret path manifest', () => {
    const assertionCall = /\bassertBetterAuthRequestSecretPath\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const asserted = sourceFiles(srcDir).flatMap((path) => {
      const rel = relative(srcDir, path);
      return [...sourceWithoutComments(rel).matchAll(assertionCall)].map((match) => match[1]);
    });
    const manifestIds = new Set(betterAuthRequestSecretPaths.map((path) => path.id));
    const assertedIds = new Set(asserted);

    expect([...assertedIds].sort()).toEqual([...manifestIds].sort());
    expect(asserted.every((id) => manifestIds.has(id))).toBe(true);
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

    // Every `auth.api.*` Kovo calls today reads plaintext and lives in the trusted module.
    expect(new Set(usages.map((usage) => usage.file))).toEqual(
      new Set([betterAuthTrustedPlaintextModule]),
    );
    expect([...new Set(usages.map((usage) => usage.method))].sort()).toEqual([
      'getSession',
      'signInEmail',
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
      new Set(['internal/credential.ts', 'internal/trusted-plaintext.ts', 'session.ts']),
    );
    expect(sourceText('internal/credential.ts')).toContain('forward(cookie,');
    expect(sourceText('session.ts')).toContain('setCookies.length > 0 ? { setCookies, value }');
  });
});
