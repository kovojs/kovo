import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { renderDocument } from './document-core.js';
import {
  BodyAttrs,
  BodyStart,
  Document,
  Head,
  HtmlAttrs,
  InlineScript,
  InlineStyle,
  Meta,
  renderShellAttributes,
} from './document-structured.js';

const intrinsicModuleUrl = new URL('./response-security-intrinsics.ts', import.meta.url).href;

describe('structured document intrinsic closure', () => {
  it('keeps shell attributes byte-identical after selective Array.join poisoning', () => {
    const document = Document({
      children: HtmlAttrs({ 'data-shell': 'safe' }),
    });
    const baseline = renderDocument({ body: '<main>safe</main>', document, loader: 'omit' }).html;
    const nativeJoin = Array.prototype.join;
    const injected = ' lang="en"><script src="/attacker.js"></script><x data-kovo="';
    let ambientControl = '';
    let rendered = '';
    try {
      Array.prototype.join = function poisonedJoin(separator) {
        if (this[0] === ' lang="en"') return injected;
        return Reflect.apply(nativeJoin, this, [separator]);
      };
      ambientControl = [' lang="en"', ' data-shell="safe"'].join('');
      rendered = renderDocument({ body: '<main>safe</main>', document, loader: 'omit' }).html;
    } finally {
      Array.prototype.join = nativeJoin;
    }

    expect(ambientControl).toBe(injected);
    expect(rendered).toBe(baseline);
    expect(rendered).not.toContain('/attacker.js');
  });

  it('pins structured traversal, validation, copying, conversion, and raw-text escaping', () => {
    const buildDocument = () =>
      Document({
        children: [
          HtmlAttrs({ 'data-count': 42, 'data-shell': 'safe' }),
          BodyAttrs({ 'data-page': 'safe' }),
          Head({
            children: [
              Meta({ content: 'safe', name: 'description' }),
              InlineScript({
                children: 'globalThis.safe="</script><script src=/attacker.js>"',
                id: 'boot',
                run: 'beforePaint',
              }),
              InlineStyle({
                children: 'body::after{content:"</style><script src=/attacker.js>"}',
                id: 'theme',
                source: 'app',
              }),
            ],
          }),
          BodyStart({ children: '<banner>safe</banner>' }),
        ],
      });

    const baseline = renderDocument({
      body: '<main>safe</main>',
      document: buildDocument(),
      loader: 'omit',
    }).html;
    const nativeAssign = Object.assign;
    const nativeEntries = Object.entries;
    const nativeIsArray = Array.isArray;
    const nativeFlatMap = Array.prototype.flatMap;
    const nativeJoin = Array.prototype.join;
    const nativeMap = Array.prototype.map;
    const nativePush = Array.prototype.push;
    const nativeRegExpExec = RegExp.prototype.exec;
    const nativeRegExpTest = RegExp.prototype.test;
    const nativeString = globalThis.String;
    const nativeStartsWith = String.prototype.startsWith;
    const nativeTrim = String.prototype.trim;
    let poisonedDocument: ReturnType<typeof Document> | undefined;
    let renderedNumericAttribute = '';
    let invalidNameError: unknown;
    let invalidPrefixError: unknown;
    let emptyIdError: unknown;
    try {
      Object.assign = ((target: object) => target) as typeof Object.assign;
      Object.entries = ((value: object) => {
        if ('data-shell' in value) {
          return [
            ['data-shell', 'substituted'],
            ['data-attacker', '"><script src=/attacker.js>'],
          ];
        }
        return Reflect.apply(nativeEntries, Object, [value]);
      }) as typeof Object.entries;
      Array.isArray = () => false;
      Array.prototype.flatMap = () => ['<script src=/attacker.js></script>'];
      Array.prototype.join = () => '<script src=/attacker.js></script>';
      Array.prototype.map = () => ['<script src=/attacker.js></script>'];
      Array.prototype.push = function poisonedPush() {
        return this.length;
      };
      RegExp.prototype.exec = () => null;
      RegExp.prototype.test = () => false;
      String.prototype.startsWith = () => true;
      String.prototype.trim = () => 'non-empty';

      poisonedDocument = buildDocument();
      globalThis.String = (() => '"><script src=/attacker.js>') as StringConstructor;
      renderedNumericAttribute = renderShellAttributes({ 'data-count': 42 });
      try {
        HtmlAttrs({ 'data-evil" onload="alert(1)': 'x' });
      } catch (error) {
        invalidNameError = error;
      }
      try {
        HtmlAttrs({ onclick: 'alert(1)' });
      } catch (error) {
        invalidPrefixError = error;
      }
      try {
        InlineScript({ children: 'safe', id: '   ', run: 'beforePaint' });
      } catch (error) {
        emptyIdError = error;
      }
    } finally {
      Object.assign = nativeAssign;
      Object.entries = nativeEntries;
      Array.isArray = nativeIsArray;
      Array.prototype.flatMap = nativeFlatMap;
      Array.prototype.join = nativeJoin;
      Array.prototype.map = nativeMap;
      Array.prototype.push = nativePush;
      RegExp.prototype.exec = nativeRegExpExec;
      RegExp.prototype.test = nativeRegExpTest;
      globalThis.String = nativeString;
      String.prototype.startsWith = nativeStartsWith;
      String.prototype.trim = nativeTrim;
    }

    expect(poisonedDocument).toBeDefined();
    const rendered = renderDocument({
      body: '<main>safe</main>',
      document: poisonedDocument!,
      loader: 'omit',
    }).html;
    expect(rendered).toBe(baseline);
    expect(rendered).toContain('<\\/script><script src=/attacker.js>');
    expect(rendered).toContain('<\\/style><script src=/attacker.js>');
    expect(renderedNumericAttribute).toBe(' data-count="42"');
    expect(invalidNameError).toBeInstanceOf(Error);
    expect(invalidPrefixError).toBeInstanceOf(Error);
    expect(emptyIdError).toBeInstanceOf(Error);
  });

  it('fails closed when the shell-attribute join is poisoned before framework import', () => {
    const script = `
      const nativeJoin = Array.prototype.join;
      Array.prototype.join = function poisonedJoin(separator) {
        if (this[0] === ' lang="en"') {
          return ' lang="en"><script src="/attacker.js"></script><x data-kovo="';
        }
        return Reflect.apply(nativeJoin, this, [separator]);
      };
      const controls = await import(${JSON.stringify(`${intrinsicModuleUrl}?structured-shell-poison`)});
      try {
        controls.assertResponseSecurityIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
