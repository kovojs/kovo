import { describe, expect, it } from 'vitest';

import { createAppDeclarationSnapshotContext, snapshotAppMutation } from './app-snapshot.js';
import { mutation } from './mutation.js';
import { s } from './schema.js';

const definitionBody = {
  handler: () => ({ accepted: true }),
  input: s.object({ value: s.string() }),
};

describe('mutation CSRF posture contract (SPEC §6.6/§9.1)', () => {
  it('requires csrf:false to carry an exact author justification at the type boundary', () => {
    if (false) {
      // @ts-expect-error SPEC §6.6: an exempt mutation must explain the exemption.
      mutation({ ...definitionBody, csrf: false });
      // @ts-expect-error Protected mutations cannot claim an exemption justification.
      mutation({ ...definitionBody, csrfJustification: 'not actually exempt' });
      // @ts-expect-error Machine replay identity is available only on the csrf:false branch.
      mutation({
        ...definitionBody,
        machineReplayPrincipal: () => 'machine-a',
      });
    }

    const exempt = mutation('machine/write', {
      ...definitionBody,
      csrf: false,
      csrfJustification: 'request is authenticated by a non-ambient HMAC header',
    });
    expect(exempt.csrf).toBe(false);
    expect(exempt.csrfJustification).toBe('request is authenticated by a non-ambient HMAC header');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
    ['control-bearing', 'signed\u0000request'],
    ['unbounded', 'x'.repeat(4_097)],
  ])('fails closed at runtime for a %s csrf:false justification', (_label, justification) => {
    expect(() =>
      mutation('machine/write', {
        ...definitionBody,
        csrf: false,
        ...(justification === undefined ? {} : { csrfJustification: justification }),
      } as never),
    ).toThrow(/csrfJustification|printable justification/);
  });

  it('rejects a justification on a protected mutation at runtime', () => {
    expect(() =>
      mutation('browser/write', {
        ...definitionBody,
        csrfJustification: 'forged exemption metadata',
      } as never),
    ).toThrow(/only valid when csrf is exactly false/);
  });

  it('rejects a machine replay principal declaration on a protected mutation', () => {
    expect(() =>
      mutation('browser/write', {
        ...definitionBody,
        machineReplayPrincipal: () => 'machine-a',
      } as never),
    ).toThrow(/machineReplayPrincipal is only valid when csrf is exactly false/u);
  });

  it('rejects accessor and non-function machine replay declarations without invoking accessors', () => {
    let reads = 0;
    const accessor = Object.defineProperty(
      {
        ...definitionBody,
        csrf: false,
        csrfJustification: 'signed inventory gateway',
      },
      'machineReplayPrincipal',
      {
        enumerable: true,
        get() {
          reads += 1;
          return () => 'machine-a';
        },
      },
    );
    expect(() => mutation('machine/accessor', accessor as never)).toThrow(
      /machineReplayPrincipal.*own data property/u,
    );
    expect(reads).toBe(0);
    expect(() =>
      mutation('machine/non-function', {
        ...definitionBody,
        csrf: false,
        csrfJustification: 'signed inventory gateway',
        machineReplayPrincipal: 'machine-a',
      } as never),
    ).toThrow(/machineReplayPrincipal must be a stable selector function/u);
  });

  it('pins the exact justification before caller mutation', () => {
    const source = {
      ...definitionBody,
      csrf: false as const,
      csrfJustification: 'signed inventory gateway',
    };
    const declared = mutation('machine/write', source);
    source.csrfJustification = 'changed after declaration';
    expect(declared.csrfJustification).toBe('signed inventory gateway');
  });

  it.each(['_charset_', '_ChArSeT_'])(
    'rejects browser-reserved mutation CSRF field %s during declaration snapshot',
    (field) => {
      expect(() =>
        mutation('browser/write', {
          ...definitionBody,
          csrf: {
            field,
            secret: 'mutation-csrf-field-secret-0123456789abcdef',
            sessionId: () => 'session-1',
          },
        }),
      ).toThrow(/KV236.*_charset_.*SPEC §13\.2.*SPEC §6\.6/u);
    },
  );

  it('revalidates forged structural declarations at the app snapshot boundary', () => {
    expect(() =>
      snapshotAppMutation(
        {
          ...definitionBody,
          csrf: false,
          key: 'machine/forged',
        } as never,
        createAppDeclarationSnapshotContext(),
      ),
    ).toThrow(/csrfJustification|printable justification/);
  });
});
