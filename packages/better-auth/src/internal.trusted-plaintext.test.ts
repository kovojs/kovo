import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  betterAuthRequestSecretPaths,
  proveBetterAuthRequestSecretNonEgress,
  type BetterAuthRequestSecretPath,
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

describe('Better Auth trusted plaintext zone', () => {
  it('proves the request-reachable auth secret surface instead of a proxy module name', () => {
    expect(proveBetterAuthRequestSecretNonEgress()).toEqual([]);

    expect(betterAuthRequestSecretPaths.map((path) => path.id)).toEqual([
      'better-auth.sign-in.submitted-password',
      'better-auth.sign-up.submitted-password',
      'better-auth.sign-out.request-cookie',
      'better-auth.get-session.request-cookie',
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

  it('confines Better Auth plaintext API calls to the trusted module', () => {
    const apiCall = /\bauth\.api\.(?:getSession|signInEmail|signOut|signUpEmail)\s*\(/g;
    const matches = sourceFiles(srcDir).flatMap((path) => {
      const rel = relative(srcDir, path);
      return [...sourceWithoutComments(rel).matchAll(apiCall)].map((match) => `${rel}:${match[0]}`);
    });

    expect(matches).toEqual([
      'internal/trusted-plaintext.ts:auth.api.signInEmail(',
      'internal/trusted-plaintext.ts:auth.api.signUpEmail(',
      'internal/trusted-plaintext.ts:auth.api.signOut(',
      'internal/trusted-plaintext.ts:auth.api.getSession(',
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
