import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import { createStaticExportHeaderSink, staticExportHeaders } from './static-export-headers.js';

describe('server static export header sink', () => {
  it('normalizes header names, merges duplicates, and sorts output', () => {
    const sink = createStaticExportHeaderSink({ path: '/assets/app.css' });

    sink.append('Cache-Control', 'public');
    sink.append('cache-control', 'max-age=60');
    sink.set('CONTENT-TYPE', 'text/css; charset=utf-8');

    expect(sink.toJSON()).toEqual({
      'cache-control': 'public, max-age=60',
      'content-type': 'text/css; charset=utf-8',
    });
  });

  it('rejects control-character header names and values', () => {
    expect(() =>
      staticExportHeaders({ ['X-Bad\nName']: 'ok' }, { path: '/assets/app.css' }),
    ).toThrow(/header name 'X-Bad\\nName' is not a valid HTTP header token/);

    expect(() =>
      staticExportHeaders({ 'X-Asset': 'ok\r\nX-Injected: yes' }, { path: '/assets/app.css' }),
    ).toThrow(/contains a control character/);
  });

  it('refuses Secret runtime values before static export header coercion', () => {
    expect(() =>
      staticExportHeaders(
        { 'X-Asset': secret('sk_live_q5_static_value') as unknown as string },
        { path: '/assets/app.css' },
      ),
    ).toThrow(/KV435 Secret query value reaches the client wire/);

    expect(() =>
      staticExportHeaders([[secret('X-Secret-Name') as unknown as string, 'ok']], {
        path: '/assets/app.css',
      }),
    ).toThrow(/KV435 Secret query value reaches the client wire/);
  });

  it('rejects Set-Cookie and framework-reserved Kovo headers', () => {
    expect(() =>
      staticExportHeaders({ 'Set-Cookie': 'sid=1; Path=/' }, { path: '/assets/app.css' }),
    ).toThrow(/cannot carry Set-Cookie/);

    expect(() =>
      staticExportHeaders({ 'Kovo-Build': 'build-a' }, { path: '/assets/app.css' }),
    ).toThrow(/framework-reserved 'Kovo-Build' headers/);
  });

  it('rejects transport-owned framing and hop-by-hop static metadata with KV415', () => {
    for (const name of [
      'Content-Length',
      'Connection',
      'Keep-Alive',
      'Proxy-Connection',
      'TE',
      'Trailer',
      'Transfer-Encoding',
      'Upgrade',
      'Proxy-Authenticate',
      'Proxy-Authorization',
      'HTTP2-Settings',
    ]) {
      expect(() =>
        staticExportHeaders({ [name]: 'attacker-controlled' }, { path: '/assets/app.css' }),
      ).toThrow(/KV229 KV415.*owned by the HTTP adapter/u);
    }
  });

  it('pins the header map write after name/value validation', () => {
    const originalSet = Map.prototype.set;
    try {
      Map.prototype.set = function (key, value) {
        if (key === 'x-frame-options' && value === 'DENY') {
          return Reflect.apply(originalSet, this, [
            'set-cookie',
            'kovo_session=attacker-fixed; Path=/; HttpOnly',
          ]);
        }
        return Reflect.apply(originalSet, this, [key, value]);
      };

      expect(staticExportHeaders({ 'X-Frame-Options': 'DENY' }, { path: '/' })).toEqual({
        'x-frame-options': 'DENY',
      });
    } finally {
      Map.prototype.set = originalSet;
    }
  });
});
