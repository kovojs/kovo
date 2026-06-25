import { describe, expect, it } from 'vitest';

import {
  assertInlineKovoLoaderInstallerResponseApplyParity,
  assertInlineKovoLoaderTrustedTypesRouting,
  buildInlineKovoLoaderInstallerReadableSource,
  buildInlineKovoLoaderInstallerSource,
  inlineResponseApplyReadableSource,
  inlineWireParserReadableSource,
} from './inline-loader-build.js';
import { inlineKovoLoaderInstallerSource } from './inline-loader.js';

describe('inline loader Trusted Types routing gate', () => {
  it('tracks Trusted Types inline sink routing independently from response sanitizer parity', () => {
    // SPEC.md §6.6: Trusted Types is the Chromium runtime-DiD layer; sanitizer parity remains
    // the cross-browser XSS floor. Keep their status gates separate so one cannot mask the other.
    const sanitizerOnlyDrift = inlineResponseApplyReadableSource.replace(
      'outerhtml|inserthtml|insertadjacenthtml',
      'outerhtml|inserthtml',
    );
    const readableInstaller = buildInlineKovoLoaderInstallerReadableSource(
      inlineWireParserReadableSource,
      sanitizerOnlyDrift,
    );
    const minifiedInstaller = buildInlineKovoLoaderInstallerSource(readableInstaller);

    expect(() =>
      assertInlineKovoLoaderTrustedTypesRouting(
        readableInstaller,
        minifiedInstaller,
        sanitizerOnlyDrift,
      ),
    ).not.toThrow();
    expect(() => assertInlineKovoLoaderInstallerResponseApplyParity(readableInstaller)).toThrow(
      'canonical response apply helper closure exactly once; found 0',
    );
  });

  it('fails when inline raw-HTML sinks stop routing through the Trusted Types shim', () => {
    const unroutedApply = inlineResponseApplyReadableSource
      .replace('t.innerHTML = trustedHtml(x.html)', 't.innerHTML = x.html')
      .replace('t.innerHTML = trustedHtml(h)', 't.innerHTML = h');
    const readableInstaller = buildInlineKovoLoaderInstallerReadableSource(
      inlineWireParserReadableSource,
      unroutedApply,
    );
    const minifiedInstaller = buildInlineKovoLoaderInstallerSource(readableInstaller);

    expect(() =>
      assertInlineKovoLoaderTrustedTypesRouting(
        readableInstaller,
        minifiedInstaller,
        unroutedApply,
      ),
    ).toThrow(
      'Trusted Types routing must wrap both readable response-apply innerHTML sinks; found 0',
    );
  });

  it('passes for the checked-in generated inline loader artifact', () => {
    expect(() =>
      assertInlineKovoLoaderTrustedTypesRouting(undefined, inlineKovoLoaderInstallerSource),
    ).not.toThrow();
  });
});
