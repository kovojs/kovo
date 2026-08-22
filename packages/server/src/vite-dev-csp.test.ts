import { describe, expect, it } from 'vitest';

import { admitKovoViteDevStyleNonce, admitKovoViteDevStyleNonceHeader } from './vite-dev-csp.js';
import { readHeader } from './response.js';

const nonce = 'AAAAAAAAAAAAAAAAAAAAAA==';
const nonceSource = `'nonce-${nonce}'`;

describe('bounded Vite development CSP nonce admission', () => {
  it('preserves default-src sources when a Route/Web header needs a new style-src', () => {
    expect(
      admitKovoViteDevStyleNonce("default-src 'self' https://styles.example; img-src data:", nonce),
    ).toBe(
      `default-src 'self' https://styles.example; img-src data:; style-src 'self' https://styles.example ${nonceSource}`,
    );
  });

  it('treats style-src, style-src-elem, and style-src-attr as exact directive names', () => {
    expect(
      admitKovoViteDevStyleNonce(
        "default-src 'self'; style-src-elem https://styles.example; style-src-attr 'unsafe-inline'",
        nonce,
      ),
    ).toBe(
      `default-src 'self'; style-src-elem https://styles.example ${nonceSource}; style-src-attr 'unsafe-inline'; style-src 'self' ${nonceSource}`,
    );
  });

  it('admits the nonce independently to every comma-separated enforced Web policy', () => {
    const admitted = admitKovoViteDevStyleNonce(
      "default-src 'self', default-src https://cdn.example; style-src https://styles.example",
      nonce,
    );

    expect(admitted).toBe(
      `default-src 'self'; style-src 'self' ${nonceSource}, default-src https://cdn.example; style-src https://styles.example ${nonceSource}`,
    );
    expect(admitted.split(nonceSource)).toHaveLength(3);
  });

  it('handles Route array joining and Web Headers folding as enforced policy lists', () => {
    const routePolicy = readHeader(
      {
        'Content-Security-Policy': ["default-src 'self'", 'style-src https://route.example'],
      },
      'Content-Security-Policy',
    );
    const webHeaders = new Headers();
    webHeaders.append('Content-Security-Policy', "default-src 'self'");
    webHeaders.append('Content-Security-Policy', 'style-src https://web.example');

    expect(admitKovoViteDevStyleNonce(String(routePolicy), nonce)).toBe(
      `default-src 'self'; style-src 'self' ${nonceSource}, style-src https://route.example ${nonceSource}`,
    );
    expect(
      admitKovoViteDevStyleNonce(String(webHeaders.get('Content-Security-Policy')), nonce),
    ).toBe(
      `default-src 'self'; style-src 'self' ${nonceSource}, style-src https://web.example ${nonceSource}`,
    );
  });

  it('preserves Node repeated-header members while parsing policy lists inside each member', () => {
    expect(
      admitKovoViteDevStyleNonceHeader(
        [
          "default-src 'self'",
          "default-src 'none'; style-src-elem 'self'; style-src-attr 'none'",
          'style-src https://one.example, default-src https://two.example',
        ],
        nonce,
      ),
    ).toEqual([
      `default-src 'self'; style-src 'self' ${nonceSource}`,
      `default-src 'none'; style-src-elem 'self' ${nonceSource}; style-src-attr 'none'; style-src 'none' ${nonceSource}`,
      `style-src https://one.example ${nonceSource}, default-src https://two.example; style-src https://two.example ${nonceSource}`,
    ]);
  });

  it('fails closed on control characters and policy/directive census overflow', () => {
    expect(() => admitKovoViteDevStyleNonce("default-src 'self'\nstyle-src *", nonce)).toThrow(
      /forbidden control character/u,
    );
    expect(() =>
      admitKovoViteDevStyleNonce(
        Array.from({ length: 33 }, () => "default-src 'self'").join(','),
        nonce,
      ),
    ).toThrow(/policy census exceeds/u);
    expect(() =>
      admitKovoViteDevStyleNonce(
        Array.from({ length: 257 }, (_, index) => `x-${String(index)} 'none'`).join(';'),
        nonce,
      ),
    ).toThrow(/directive census exceeds/u);
  });
});
