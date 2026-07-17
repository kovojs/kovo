import { validateHeaderValue } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createContentDispositionWithFilename } from './content-disposition.js';

const contentDispositionWithFilename = createContentDispositionWithFilename({
  charCodeAt: (value, index) => value.charCodeAt(index),
  encodeURIComponent: (value) => encodeURIComponent(value),
  slice: (value, start, end) => value.slice(start, end),
  trim: (value) => value.trim(),
});

describe('shared Content-Disposition filename serializer', () => {
  it('keeps printable ASCII while collapsing separators and escaping quotes', () => {
    expect(contentDispositionWithFilename('attachment', 'safe.txt')).toBe(
      'attachment; filename="safe.txt"',
    );
    expect(contentDispositionWithFilename('inline', 'a"b\\//c.txt')).toBe(
      'inline; filename="a\\"b_c.txt"',
    );
    expect(contentDispositionWithFilename('attachment', '   ')).toBe(
      'attachment; filename="download"',
    );
  });

  it('uses an ASCII fallback plus RFC 8187 filename* for Unicode and attr-char residues', () => {
    expect(contentDispositionWithFilename('inline', 'emoji-💣.txt')).toBe(
      `inline; filename="emoji-_.txt"; filename*=UTF-8''emoji-%F0%9F%92%A3.txt`,
    );
    expect(contentDispositionWithFilename('attachment', "résumé'().*.pdf")).toBe(
      `attachment; filename="r_sum_'().*.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%27%28%29.%2A.pdf`,
    );
  });

  it('neutralizes Unicode bidirectional formatting controls before filename serialization', () => {
    const bidirectionalControls = [
      '\u061c',
      '\u200e',
      '\u200f',
      '\u202a',
      '\u202b',
      '\u202c',
      '\u202d',
      '\u202e',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
    ];

    for (const control of bidirectionalControls) {
      expect(contentDispositionWithFilename('attachment', `left${control}right.exe`)).toBe(
        'attachment; filename="left_right.exe"',
      );
    }

    expect(contentDispositionWithFilename('attachment', 'invoice\u202efdp.exe')).toBe(
      'attachment; filename="invoice_fdp.exe"',
    );
  });

  it('repairs lone surrogates before encoding so Node accepts the header', () => {
    const values = [
      contentDispositionWithFilename('inline', 'broken-\ud800.txt'),
      contentDispositionWithFilename('inline', 'broken-\udc00.txt'),
      contentDispositionWithFilename('inline', 'emoji-💣.txt'),
    ];

    expect(values[0]).toBe(
      `inline; filename="broken-_.txt"; filename*=UTF-8''broken-%EF%BF%BD.txt`,
    );
    expect(values[1]).toBe(values[0]);
    for (const value of values) {
      expect(() => validateHeaderValue('Content-Disposition', value)).not.toThrow();
    }
  });

  it('preserves the 255 UTF-16 input-unit boundary before separator collapsing', () => {
    const twoHundredFiftyFour = 'a'.repeat(254);
    expect(contentDispositionWithFilename('attachment', `${twoHundredFiftyFour}💣`)).toBe(
      `attachment; filename="${twoHundredFiftyFour}"`,
    );
    expect(contentDispositionWithFilename('inline', `${'/'.repeat(254)}💣`)).toBe(
      'inline; filename="_"',
    );
    expect(contentDispositionWithFilename('attachment', `${'a'.repeat(253)}💣`)).toBe(
      `attachment; filename="${'a'.repeat(253)}_"; filename*=UTF-8''${'a'.repeat(253)}%F0%9F%92%A3`,
    );
  });
});
