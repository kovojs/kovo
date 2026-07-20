import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoExplain } from './graph-output.js';

describe('kovo explain --auth-lifecycle (Plan 3 §5.3 C13 anchor)', () => {
  it('parses as a graph-independent exclusive explain mode without changing model boundaries', () => {
    expect(parseExplainArgs(['--auth-lifecycle'])).toEqual({
      inputPath: undefined,
      ok: true,
      options: { authLifecycle: true },
    });
    expect(parseExplainArgs(['--auth-lifecycle', 'graph.json'])).toMatchObject({ ok: false });
    expect(parseExplainArgs(['--auth-lifecycle', '--model-boundaries'])).toMatchObject({
      ok: false,
    });

    expect(kovoExplain({}, { modelBoundaries: true } as never).output).toContain(
      'MODEL-BOUNDARY replay-reservation/v1 status=registered-not-model-checked\n',
    );
  });

  it('prints inherited defaults, exactly four Kovo-owned transitions, and the honest complement', () => {
    expect(kovoExplain({}, { authLifecycle: true } as never)).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'AUTH-LIFECYCLE provider=better-auth version=1.6.17 posture=inherited-exact-pin',
        'INHERITED expiresIn=604800 updateAge=86400 freshAge=86400 cookieCacheEnabled=false cookieCacheMaxAge=300 preexistingCookieSignIn=rotates-id-and-token-retains-prior-session',
        'OWNED signIn upstream=signInEmail surface=auth/sign-in devOnly=false',
        'OWNED signOut upstream=signOut surface=auth/sign-out devOnly=false',
        'OWNED seedSignUp upstream=signUpEmail surface=developmentSeed devOnly=true',
        'OWNED requestPasswordReset upstream=requestPasswordReset surface=auth/request-password-reset devOnly=false feature=password-reset-mail',
        'UNREACHABLE unsafe-method-provider-lifecycle reason="the opaque provider mount accepts GET only and no other direct provider API is exposed"',
        'DELEGATED get-provider-callback-lifecycle status=unsupported reason="the opaque GET redirect/callback mount can change identity state under Better Auth; Kovo does not guarantee those lifecycle semantics"',
        'NON-CLAIM "Kovo guarantees only its four owned transitions, with requestPasswordReset present only when its purpose-closed mail feature is configured; reset completion and reachable Better Auth GET callback lifecycle remain delegated and unsupported."',
        'SUMMARY kovoOwned=4 structurallyUnreachable=1 delegatedReachable=1',
        '',
      ].join('\n'),
    });
  });

  it('keeps the same explicit ownership and non-claim in SPEC §6.6', () => {
    const spec = readFileSync(new URL('../../../spec/06-type-system.md', import.meta.url), 'utf8');
    expect(spec).toContain('**Better Auth lifecycle ownership and non-claims (normative).**');
    expect(spec).toContain('exactly four Kovo-owned identity transitions');
    expect(spec).toContain('purpose-closed password-reset mail door');
    expect(spec).toMatch(/reachable GET\s+callback lifecycle is delegated and unsupported/u);
  });
});
