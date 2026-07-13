import { findStringEnd } from './text.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateNullRecord,
  compilerDefineOwnDataProperty,
  compilerNumberValue,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerRegExpTest,
  compilerStringEndsWith,
  compilerStringIndexOf,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';

const literalNumberPattern = /^-?\d+(?:\.\d+)?$/;
const objectIdentifierPattern = /^[A-Za-z_$][\w$]*/;
const whitespacePattern = /^\s$/;

export type StaticLiteralValue =
  | boolean
  | null
  | number
  | string
  | readonly StaticLiteralValue[]
  | {
      readonly [key: string]: StaticLiteralValue;
    };

export function parseLiteralObject(source: string): Record<string, StaticLiteralValue> | null {
  const trimmed = compilerStringTrim(source);
  if (!compilerStringStartsWith(trimmed, '{') || !compilerStringEndsWith(trimmed, '}')) return null;

  const parsedEntries = topLevelObjectEntries(trimmed);
  const entries = compilerCreateNullRecord<StaticLiteralValue>();
  const entryCount = compilerArrayLength(parsedEntries, 'Compiler literal object entries');
  for (let index = 0; index < entryCount; index += 1) {
    const entry = compilerOwnDataValue(parsedEntries, index, 'Compiler literal object entries') as {
      key: string;
      value: string;
    };
    const value = literalValue(entry.value);
    if (value === undefined) return null;
    compilerDefineOwnDataProperty(entries, entry.key, value);
  }

  return entries;
}

export function literalValue(value: string): StaticLiteralValue | undefined {
  let trimmed = compilerStringTrim(value);
  if (compilerStringEndsWith(trimmed, ',')) {
    trimmed = compilerStringTrim(compilerStringSlice(trimmed, 0, -1));
  }
  if (compilerStringStartsWith(trimmed, '{') && compilerStringEndsWith(trimmed, '}')) {
    return parseLiteralObject(trimmed) ?? undefined;
  }
  if (compilerStringStartsWith(trimmed, '[') && compilerStringEndsWith(trimmed, ']')) {
    return parseLiteralArray(trimmed) ?? undefined;
  }

  const stringValue = literalStringValue(trimmed);
  if (stringValue !== null) return stringValue;
  if (compilerRegExpTest(literalNumberPattern, trimmed)) return compilerNumberValue(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  return undefined;
}

function parseLiteralArray(source: string): readonly StaticLiteralValue[] | null {
  const values: StaticLiteralValue[] = [];
  let index = 1;

  while (index < source.length - 1) {
    index = skipWhitespaceAndComments(source, index);
    if (source[index] === ',') {
      index += 1;
      continue;
    }

    const valueEnd = skipObjectValue(source, index);
    const value = literalValue(compilerStringTrim(compilerStringSlice(source, index, valueEnd)));
    if (value === undefined) return null;
    compilerArrayAppend(values, value, 'Compiler literal array values');
    index = valueEnd;
  }

  return values;
}

export function literalStringValue(value: string): string | null {
  const trimmed = compilerStringTrim(value);
  const quote = trimmed[0];
  const last = compilerStringSlice(trimmed, -1);
  if ((quote !== '"' && quote !== "'") || last !== quote) return null;
  return compilerStringSlice(trimmed, 1, -1);
}

function topLevelObjectEntries(objectSource: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  let index = 1;

  while (index < objectSource.length - 1) {
    index = skipWhitespaceAndComments(objectSource, index);
    if (objectSource[index] === ',') {
      index += 1;
      continue;
    }

    const key = readObjectKey(objectSource, index);
    if (!key) {
      index = skipObjectValue(objectSource, index);
      continue;
    }

    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] !== ':') {
      index = skipObjectValue(objectSource, afterKey);
      continue;
    }

    const valueStart = skipWhitespaceAndComments(objectSource, afterKey + 1);
    const valueEnd = skipObjectValue(objectSource, valueStart);
    compilerArrayAppend(
      entries,
      {
        key: key.name,
        value: compilerStringTrim(compilerStringSlice(objectSource, valueStart, valueEnd)),
      },
      'Compiler literal object entries',
    );
    index = valueEnd;
  }

  return entries;
}

function readObjectKey(source: string, start: number): { name: string; end: number } | null {
  const char = source[start];
  if (char === '"' || char === "'") {
    const end = findStringEnd(source, start, char);
    if (end === -1) return null;

    return {
      end: end + 1,
      name: compilerStringSlice(source, start + 1, end),
    };
  }

  const identifier = compilerRegExpExec(
    objectIdentifierPattern,
    compilerStringSlice(source, start),
  );
  const identifierText =
    identifier === null
      ? undefined
      : compilerOwnDataValue(identifier, 0, 'Compiler literal object key match');
  if (typeof identifierText !== 'string' || identifierText === '') return null;

  return {
    end: start + identifierText.length,
    name: identifierText,
  };
}

function skipObjectValue(source: string, start: number): number {
  let index = start;
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;

  while (index < source.length - 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length - 1 : end + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = compilerStringIndexOf(source, '\n', index + 2);
      index = nextLine === -1 ? source.length - 1 : nextLine + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = compilerStringIndexOf(source, '*/', index + 2);
      index = commentEnd === -1 ? source.length - 1 : commentEnd + 2;
      continue;
    }

    if (char === '{') curlyDepth += 1;
    if (char === '}') {
      if (curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) return index;
      curlyDepth -= 1;
    }

    if (char === '[') squareDepth += 1;
    if (char === ']') squareDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;

    if (char === ',' && curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (compilerRegExpTest(whitespacePattern, source[index] ?? '')) {
      index += 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '/') {
      const nextLine = compilerStringIndexOf(source, '\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }

    if (source[index] === '/' && source[index + 1] === '*') {
      const commentEnd = compilerStringIndexOf(source, '*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }

    return index;
  }

  return index;
}
