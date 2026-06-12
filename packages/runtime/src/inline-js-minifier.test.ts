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
});
