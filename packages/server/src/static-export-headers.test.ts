import { describe, expect, it } from 'vitest';

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

  it('rejects Set-Cookie and framework-reserved Kovo headers', () => {
    expect(() =>
      staticExportHeaders({ 'Set-Cookie': 'sid=1; Path=/' }, { path: '/assets/app.css' }),
    ).toThrow(/cannot carry Set-Cookie/);

    expect(() =>
      staticExportHeaders({ 'Kovo-Build': 'build-a' }, { path: '/assets/app.css' }),
    ).toThrow(/framework-reserved 'Kovo-Build' headers/);
  });
});
