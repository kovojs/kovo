import { describe, expect, it } from 'vitest';

import {
  blessSink,
  decideRuntimeAttributeWrite,
  hasUnsafeCssText,
  hasUnsafeCssUrl,
  isBlessedSink,
  sanitizeRuntimeSrcset,
  SRCSET_ATTRIBUTE_NAMES,
  runtimeSinkFamilyForAttribute,
} from './internal/sink-policy.js';

describe('shared Blessed<Sink> witness substrate (SPEC §6.6)', () => {
  it('recognizes only values minted through the module-private witness registry', () => {
    const capability = {};
    const blessed = blessSink('test-sink', capability);

    expect(blessed).toBe(capability);
    expect(isBlessedSink('test-sink', capability)).toBe(true);
    expect(isBlessedSink('other-sink', capability)).toBe(false);
    expect(Object.getOwnPropertySymbols(capability)).toEqual([]);
  });

  it('rejects forged or copied brand-like properties', () => {
    const blessed = blessSink('copy-source', { marker: 'source' });
    const copied = { ...blessed };
    const forged: Record<string, unknown> = {
      __kovoBlessedSink: 'copy-source',
    };

    expect(isBlessedSink('copy-source', copied)).toBe(false);
    expect(isBlessedSink('copy-source', forged)).toBe(false);
    expect(isBlessedSink('copy-source', null)).toBe(false);
  });
});

describe('shared runtime sink policy', () => {
  it('classifies unsafe runtime sink families', () => {
    expect(runtimeSinkFamilyForAttribute('href')).toBe('url');
    expect(runtimeSinkFamilyForAttribute('srcset')).toBe('srcset');
    expect(runtimeSinkFamilyForAttribute('imagesrcset')).toBe('srcset');
    expect(runtimeSinkFamilyForAttribute('onclick')).toBe('event-handler');
    expect(runtimeSinkFamilyForAttribute('on:click')).toBe('attribute');
    expect(runtimeSinkFamilyForAttribute('srcdoc')).toBe('srcdoc');
    expect(runtimeSinkFamilyForAttribute('innerHTML')).toBe('raw-html');
    expect(runtimeSinkFamilyForAttribute('style')).toBe('css-text');
    expect(SRCSET_ATTRIBUTE_NAMES).toEqual(['srcset', 'imagesrcset']);
  });

  it('decides URL, event, raw HTML, srcdoc, and CSS text writes with structured events', () => {
    expect(decideRuntimeAttributeWrite('href', '/cart')).toEqual({
      action: 'allow',
      family: 'url',
      value: '/cart',
    });
    expect(decideRuntimeAttributeWrite('href', 'java\nscript:alert(SECRET_TOKEN)')).toMatchObject({
      action: 'neutralize',
      event: {
        action: 'neutralize',
        code: 'KV236',
        family: 'url',
        message: 'KV236 runtime neutralize for url sink "href": URL scheme is not allowed',
        reason: 'URL scheme is not allowed',
        sink: 'href',
        value: { length: 31, preview: '<redacted:31>', redacted: true },
      },
      family: 'url',
      value: '#',
    });
    expect(decideRuntimeAttributeWrite('ONCLICK', 'alert(document.cookie)')).toMatchObject({
      action: 'remove',
      event: {
        action: 'remove',
        code: 'KV236',
        family: 'event-handler',
        message:
          'KV236 runtime remove for event-handler sink "ONCLICK": runtime write would create executable markup',
        sink: 'ONCLICK',
        value: { redacted: true },
      },
      family: 'event-handler',
    });
    expect(decideRuntimeAttributeWrite('on:click', '/c/client.js#run')).toEqual({
      action: 'allow',
      family: 'attribute',
      value: '/c/client.js#run',
    });
    expect(decideRuntimeAttributeWrite('srcdoc', '<script>alert(1)</script>').action).toBe(
      'remove',
    );
    expect(decideRuntimeAttributeWrite('innerHTML', '<img src=x onerror=alert(1)>').action).toBe(
      'remove',
    );
    expect(decideRuntimeAttributeWrite('style', 'background:url(javascript:alert(1))').action).toBe(
      'remove',
    );
    expect(decideRuntimeAttributeWrite('style', 'min-height: 120px').action).toBe('allow');
  });

  it('parses srcset and drops unsafe candidates without dropping safe candidates', () => {
    expect(
      sanitizeRuntimeSrcset(
        '/img-small.png 1x, javascript:alert(1) 2x, https://cdn.test/img.png 3x',
      ),
    ).toBe('/img-small.png 1x, https://cdn.test/img.png 3x');
    expect(sanitizeRuntimeSrcset('java\tscript:alert(1) 1x')).toBeNull();
    expect(decideRuntimeAttributeWrite('srcset', '/safe.png 1x, data:text/html 2x')).toEqual(
      expect.objectContaining({
        action: 'neutralize',
        family: 'srcset',
        value: '/safe.png 1x',
      }),
    );
  });

  it('recognizes unsafe CSS url() values while allowing ordinary CSS text inspection', () => {
    expect(hasUnsafeCssUrl('background:url(javascript:alert(1))')).toBe(true);
    expect(hasUnsafeCssUrl('background-image: url("java\nscript:alert(1)")')).toBe(true);
    expect(hasUnsafeCssUrl('background:url(/assets/hero.png)')).toBe(false);
    expect(hasUnsafeCssUrl('color: red')).toBe(false);
    expect(hasUnsafeCssText('width: expression(alert(1))')).toBe(true);
    expect(hasUnsafeCssText('-moz-binding: url("http://example.test/xss.xml#xss")')).toBe(true);
    expect(hasUnsafeCssText('min-height: 120px; overflow: auto')).toBe(false);
  });
});
