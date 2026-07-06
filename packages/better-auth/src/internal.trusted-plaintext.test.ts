import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

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
