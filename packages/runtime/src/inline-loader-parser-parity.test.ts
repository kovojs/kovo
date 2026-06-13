import { describe, expect, it } from 'vitest';

import {
  assertInlineJisoLoaderInstallerWireParserParity,
  assertMinifiedInlineJisoLoaderInstallerWireParserParity,
  buildInlineJisoLoaderInstallerReadableSource,
  buildInlineJisoLoaderInstallerSource,
  extractInlineWireParserReadableSource,
  inlineJisoLoaderInstallerReadableSource,
  inlineWireParserReadableSource,
} from './inline-loader-build.js';

describe('inline loader parser parity', () => {
  it('generates readable inline loader source around the canonical parser helpers', () => {
    // SPEC.md §4.4/§9.1: the inline bootstrap scans the same query/fragment
    // chunks as the modular runtime, so readable source is generated from the
    // extracted parser helper closure instead of carrying a hand-copied parser.
    const alternateReadableParser = [
      'function readAttribute(attrs, name) {',
      '  return attrs + ":" + name;',
      '}',
      'function readElementChunks(body) {',
      '  return [{ attrs: readAttribute(body, "target"), content: body }];',
      '}',
      'function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body, "fw-fragment"), queries: readElementChunks(body, "fw-query") };',
      '}',
    ].join('\n');

    const defaultReadable = buildInlineJisoLoaderInstallerReadableSource();
    const alternateReadable = buildInlineJisoLoaderInstallerReadableSource(alternateReadableParser);

    expect(defaultReadable).toBe(inlineJisoLoaderInstallerReadableSource);
    expect(defaultReadable).toContain(inlineWireParserReadableSource);
    expect(inlineWireParserReadableSource).toContain('function readElementChunks(');
    expect(inlineWireParserReadableSource).toContain('function readMutationResponseElementChunks(');
    expect(inlineWireParserReadableSource).not.toContain('export function');
    expect(alternateReadable).toContain(alternateReadableParser);
    expect(alternateReadable).not.toContain(inlineWireParserReadableSource);
    expect(alternateReadable).toContain('readMutationResponseElementChunks(body)');
  });

  it('extracts the inline wire parser dependency closure from the modular parser', () => {
    // SPEC.md §4.4/§9.1: parser helper extraction follows function dependencies
    // from the modular runtime parser and excludes unrelated helpers.
    const source = [
      'export function readElementChunks(body) {',
      '  return matchingElementEnd(body) + readAttribute("", "target");',
      '}',
      'function matchingElementEnd(body) {',
      '  return tagClose(body) + escapeRegExp(body);',
      '}',
      'function tagClose(source) {',
      '  return source.length;',
      '}',
      'function escapeRegExp(value) {',
      '  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
      '}',
      'export function readAttribute(attrs, name) {',
      '  return unescapeHtml(attrs + name);',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body, "fw-fragment"), queries: readElementChunks(body, "fw-query") };',
      '}',
      'function unescapeHtml(value) {',
      '  return value.replaceAll("&amp;", "&");',
      '}',
      'function unusedHelper() {',
      '  return "unused";',
      '}',
    ].join('\n');

    const extracted = extractInlineWireParserReadableSource(source);

    expect(extracted).toMatch(
      /^function tagClose\(source\).*function escapeRegExp\(value\).*function matchingElementEnd\(body\).*function unescapeHtml\(value\).*function readAttribute\(attrs, name\).*function readElementChunks\(body\).*function readMutationResponseElementChunks\(body\)/s,
    );
    expect(extracted).not.toContain('unusedHelper');
    expect(extracted).not.toContain('export function');
  });

  it('checks readable and minified inline parser embeds against the modular parser', () => {
    // SPEC.md §4.4/§9.1: inline response scanning is allowed to be tiny, but
    // build-time checks must keep it byte-tied to the modular wire parser.
    const canonicalParser = [
      'export function readElementChunks(body) {',
      '  return readAttribute("", "target") + body;',
      '}',
      'export function readAttribute(attrs, name) {',
      '  return attrs + name;',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return { fragments: readElementChunks(body, "fw-fragment"), queries: readElementChunks(body, "fw-query") };',
      '}',
    ].join('\n');
    const canonicalReadable = extractInlineWireParserReadableSource(canonicalParser);
    const readableInstaller = buildInlineJisoLoaderInstallerReadableSource(canonicalReadable);
    const minifiedInstaller = buildInlineJisoLoaderInstallerSource(readableInstaller);

    expect(() =>
      assertInlineJisoLoaderInstallerWireParserParity(readableInstaller, canonicalParser),
    ).not.toThrow();
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(minifiedInstaller, canonicalParser),
    ).not.toThrow();
    expect(() =>
      assertInlineJisoLoaderInstallerWireParserParity(
        readableInstaller.replace('return attrs + name;', 'return name + attrs;'),
        canonicalParser,
      ),
    ).toThrow('canonical wire parser helper closure exactly once; found 0');
    expect(() =>
      assertMinifiedInlineJisoLoaderInstallerWireParserParity(
        minifiedInstaller.replace('return attrs+name', 'return name+attrs'),
        canonicalParser,
      ),
    ).toThrow('canonical minified wire parser helper closure exactly once; found 0');
  });

  it('rejects inline wire parser helpers that reach outside the function closure', () => {
    // SPEC.md §4.4: the inline parser extractor is intentionally narrow; new
    // helper dependencies must be self-contained before they enter the bootstrap.
    const functionLocalSource = [
      'const hiddenHelper = (value) => value;',
      'export function readElementChunks(body) {',
      '  return hiddenHelper(body);',
      '}',
      'export function readAttribute(attrs) {',
      '  return attrs;',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
    ].join('\n');
    const importedHelperSource = [
      'import { parseJsonValue } from "./json.js";',
      'export function readElementChunks(body) {',
      '  return readAttribute("", "target") + body;',
      '}',
      'export function readAttribute(attrs) {',
      '  return parseJsonValue(attrs).value;',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
    ].join('\n');
    const topLevelValueSource = [
      'const attributePattern = /target/;',
      'export function readElementChunks(body) {',
      '  return readAttribute("", "target") + body;',
      '}',
      'export function readAttribute(attrs) {',
      '  return attributePattern.test(attrs) ? attrs : null;',
      '}',
      'export function readMutationResponseElementChunks(body) {',
      '  return readElementChunks(body);',
      '}',
    ].join('\n');

    expect(() => extractInlineWireParserReadableSource(functionLocalSource)).toThrow(
      'references top-level binding hiddenHelper',
    );
    expect(() => extractInlineWireParserReadableSource(importedHelperSource)).toThrow(
      'references top-level binding parseJsonValue',
    );
    expect(() => extractInlineWireParserReadableSource(topLevelValueSource)).toThrow(
      'references top-level binding attributePattern',
    );
  });
});
