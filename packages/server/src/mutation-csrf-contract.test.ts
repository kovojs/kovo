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
