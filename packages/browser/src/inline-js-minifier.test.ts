import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { minifyInlineJavaScriptSource } from './inline-js-minifier.js';

describe('inline JavaScript minifier', () => {
  it('preserves string, comment, and regex token hazards while compacting source', () => {
    // SPEC.md §4.4: build-time minification must not alter always-loaded loader behavior.
    const hazardSource = [
      'function inlineMinifierHazards(value) {',
      "  const stringLiteral = 'keep // and /* comment markers */ and spaces';",
      '  const templateLiteral = `template // marker`;',
      "  const joined = ['left', 'right'].join('; ');",
      '  const numeric = 2;',
      '  const plusWhitespace = numeric + +1;',
      '  const minusWhitespace = numeric - -1;',
      '  const plusComment = numeric+/* plus gap */+1;',
      '  const minusComment = numeric-/* minus gap */-1;',
      '  const commentReturn = () => { return/* return gap */value; };',
      '  const keywordBoundary = value instanceof String;',
      '  const numericKeywordBoundary = 1 in { 1: true };',
      '  const slashRegexBoundary = 4 / /2/.source.length;',
      '  const regexSlashRegexBoundary = /left/.source.length / /right/.source.length;',
      '  const regexDivisionBoundary = /left/ / numeric;',
      '  const commentRegex = /\\/\\/|\\/\\*/g;',
      '  const spacedRegex = /left right\\/slash/g;',
      '  const classSpaceRegex = /[ /#]+/g;',
      '  const regexInstance = /left right/ instanceof RegExp;',
      '  const regexPlusRegex = /left/.source + /right/.source;',
      '  const afterReturn = (candidate) => {',
      '    return /\\/\\/|\\/\\*/.test(candidate);',
      '  };',
      '  const afterArrow = (candidate) => /;\\s/.test(candidate);',
      '  return {',
      '    afterArrow: afterArrow(joined),',
      '    afterReturn: afterReturn(value),',
      "    classSpaceRegex: classSpaceRegex.test(' /#'),",
      '    commentHits: value.match(commentRegex)?.length ?? 0,',
      '    commentReturn: commentReturn(),',
      '    joined,',
      '    keywordBoundary,',
      '    minusComment,',
      '    minusWhitespace,',
      '    numericKeywordBoundary,',
      '    plusComment,',
      '    plusWhitespace,',
      '    regexInstance,',
      '    regexDivisionBoundary,',
      '    regexPlusRegex,',
      '    regexSlashRegexBoundary,',
      '    slashRegexBoundary,',
      "    spacedRegex: spacedRegex.test('left right/slash'),",
      '    stringLiteral,',
      '    templateLiteral,',
      '  };',
      '}',
    ].join('\n');
    const minifiedSource = minifyInlineJavaScriptSource(hazardSource);
    const readable = runInThisContext(`(${hazardSource})`) as (value: string) => unknown;
    const minified = runInThisContext(`(${minifiedSource})`) as (value: string) => unknown;
    const input = 'path // query /* block marker */';

    expect(minifiedSource).toBe(minifiedSource.trim());
    expect(minifiedSource).not.toMatch(/\n|\s{2,}/);
    expect(minifiedSource).toContain("'keep // and /* comment markers */ and spaces'");
    expect(minifiedSource).toContain('numeric+ +1');
    expect(minifiedSource).toContain('numeric- -1');
    expect(minifiedSource).toContain('return value');
    expect(minifiedSource).toContain('value instanceof String');
    expect(minifiedSource).toContain('1 in{1:true}');
    expect(minifiedSource).toContain('4/ /2/.source.length');
    expect(minifiedSource).toContain('/left/.source.length/ /right/.source.length');
    expect(minifiedSource).toContain('/left/ /numeric');
    expect(minifiedSource).toContain('/left right\\/slash/g');
    expect(minifiedSource).toContain('/[ /#]+/g');
    expect(minifiedSource).toContain('/left right/ instanceof RegExp');
    expect(minifiedSource).toContain('/left/.source+/right/.source');
    expect(minifiedSource).toContain("join('; ')");
    expect(minified(input)).toEqual(readable(input));
  });

  it('rejects template interpolation and invalid JavaScript before shipping source', () => {
    // SPEC.md §4.4: generated bootstrap source must be syntax-checked before shipping.
    expect(() =>
      minifyInlineJavaScriptSource(
        ['function unsupportedTemplate(value) {', '  return `loader ${value}`;', '}'].join('\n'),
      ),
    ).toThrow('template interpolation');
    expect(() => minifyInlineJavaScriptSource('function invalidInlineLoader(')).toThrow(
      'invalid JavaScript',
    );
  });

  it('rejects TypeScript-only syntax that the TypeScript parser accepts in JS mode', () => {
    // SPEC.md §4.4 ships the bootstrap as inline browser JavaScript, so build-time
    // parsing must reject TS-only syntax instead of preserving invalid script text.
    expect(() =>
      minifyInlineJavaScriptSource('function typed(value: string) { return value; }'),
    ).toThrow('TypeScript-only syntax');
    expect(() => minifyInlineJavaScriptSource('const value = input as string;')).toThrow(
      'TypeScript-only syntax',
    );
    expect(() => minifyInlineJavaScriptSource('interface InlineOnly { value: string }')).toThrow(
      'interface declaration',
    );
    expect(() => minifyInlineJavaScriptSource('enum InlineOnly { Value }')).toThrow(
      'enum declaration',
    );
  });

  it('keeps readable and printed inline JavaScript parse shapes in parity before compaction', () => {
    // SPEC.md §4.4: the readable bootstrap, compiler-printed source, and
    // minified source must remain the same parsed program at build time.
    const source = [
      'function readableParity(input) {',
      '  const output = []',
      '  // ASI and comments are allowed, but must not change the parsed program.',
      '  output.push(input?.value ?? "fallback")',
      '  return output.join("; ")',
      '}',
    ].join('\n');
    const minifiedSource = minifyInlineJavaScriptSource(source);
    const readable = runInThisContext(`(${source})`) as (input?: { value?: string }) => string;
    const minified = runInThisContext(`(${minifiedSource})`) as (input?: {
      value?: string;
    }) => string;

    expect(minified({ value: 'ready' })).toBe(readable({ value: 'ready' }));
    expect(minified(undefined)).toBe(readable(undefined));
    expect(minifiedSource).not.toContain('ASI and comments');
  });
});
