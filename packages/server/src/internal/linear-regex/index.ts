import {
  createSecuritySet,
  securityArrayPush,
  securityCreateUint8Array,
  securitySetAdd,
  securitySetHas,
  securityStringCharCodeAt,
  securityStringFromCharCode,
  securityStringSlice,
  securityUint8ArrayFill,
} from '../../response-security-intrinsics.js';

export type LinearRegexFlags = Readonly<{
  dotAll: boolean;
  ignoreCase: boolean;
  multiline: boolean;
}>;

export interface LinearRegexProgram {
  readonly flags: LinearRegexFlags;
  readonly instructions: readonly Instruction[];
  readonly source: string;
}

export class LinearRegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinearRegexError';
  }
}

type Ast =
  | { kind: 'alt'; branches: readonly Ast[] }
  | { kind: 'anchor'; anchor: AnchorKind }
  | { kind: 'char'; matcher: CharMatcher }
  | { kind: 'concat'; nodes: readonly Ast[] }
  | { kind: 'empty' }
  | { kind: 'repeat'; node: Ast; min: number; max: number | null };

type AnchorKind = 'begin' | 'end' | 'word-boundary' | 'not-word-boundary';

type CharMatcher =
  | { kind: 'any' }
  | { kind: 'class'; negated: boolean; ranges: readonly CharRange[] }
  | { kind: 'dot' };

interface CharRange {
  readonly from: number;
  readonly to: number;
}

type Instruction =
  | { type: 'assert'; anchor: AnchorKind; out: number }
  | { type: 'char'; matcher: CharMatcher; out: number }
  | { type: 'jmp'; out: number }
  | { type: 'match' }
  | { type: 'split'; out: number; out1: number };

const NO_OUT = -1;
const DEFAULT_PROGRAM_SIZE_LIMIT = 4000;

export function compileLinearRegex(
  source: string,
  flagsText = '',
  options: { readonly programSizeLimit?: number } = {},
): LinearRegexProgram {
  const flags = parseFlags(flagsText);
  if (flags.ignoreCase && containsNonAscii(source)) {
    throw new LinearRegexError(
      'pattern(): non-ASCII pattern source with the i flag is not supported; use unsafeRegex(...)',
    );
  }
  const ast = new Parser(source).parse();
  const compiler = new Compiler(options.programSizeLimit ?? DEFAULT_PROGRAM_SIZE_LIMIT);
  return { flags, instructions: compiler.compile(ast), source };
}

export function linearRegexMatch(program: LinearRegexProgram, input: string): boolean {
  const instructions = program.instructions;
  let current = createStateSet(instructions.length);
  let next = createStateSet(instructions.length);

  addState(program, input, current, 0, 0);
  if (current.matched) return true;

  for (let index = 0; index < input.length; index += 1) {
    resetStateSet(next);
    const charCode = securityStringCharCodeAt(input, index);
    for (let stateIndex = 0; stateIndex < current.count; stateIndex += 1) {
      const instruction = instructions[current.states[stateIndex] ?? 0];
      if (instruction?.type !== 'char') continue;
      if (matchesChar(instruction.matcher, charCode, program.flags)) {
        addState(program, input, next, instruction.out, index + 1);
      }
    }
    const swap = current;
    current = next;
    next = swap;
    if (current.matched) return true;
  }

  return current.matched;
}

class Parser {
  #index = 0;

  constructor(readonly source: string) {}

  parse(): Ast {
    const ast = this.#parseAlt();
    if (!this.#done()) {
      this.#fail(`unexpected "${this.source[this.#index]}"`);
    }
    return ast;
  }

  #parseAlt(): Ast {
    const branches: Ast[] = [this.#parseConcat()];
    while (this.#peek() === '|') {
      this.#index += 1;
      securityArrayPush(branches, this.#parseConcat());
    }
    return branches.length === 1 ? (branches[0] ?? empty()) : { kind: 'alt', branches };
  }

  #parseConcat(): Ast {
    const nodes: Ast[] = [];
    while (!this.#done()) {
      const ch = this.#peek();
      if (ch === ')' || ch === '|') break;
      securityArrayPush(nodes, this.#parseRepeat());
    }
    if (nodes.length === 0) return empty();
    return nodes.length === 1 ? (nodes[0] ?? empty()) : { kind: 'concat', nodes };
  }

  #parseRepeat(): Ast {
    let node = this.#parseAtom();
    for (;;) {
      const quantifier = this.#readQuantifier();
      if (!quantifier) return node;
      if (node.kind === 'anchor') this.#fail('cannot quantify an anchor');
      node = { kind: 'repeat', node, min: quantifier.min, max: quantifier.max };
      if (this.#peek() === '?') this.#index += 1;
    }
  }

  #parseAtom(): Ast {
    const ch = this.#peek();
    if (ch === undefined) return empty();
    if (ch === '(') return this.#parseGroup();
    if (ch === '[') return this.#parseClass();
    if (ch === '\\') return this.#parseEscape(false);
    if (ch === '.') {
      this.#index += 1;
      return { kind: 'char', matcher: { kind: 'dot' } };
    }
    if (ch === '^') {
      this.#index += 1;
      return { kind: 'anchor', anchor: 'begin' };
    }
    if (ch === '$') {
      this.#index += 1;
      return { kind: 'anchor', anchor: 'end' };
    }
    if (ch === '*' || ch === '+' || ch === '?' || ch === '{' || ch === '}') {
      this.#fail(`nothing to repeat before "${ch}"`);
    }
    this.#index += 1;
    return literal(ch);
  }

  #parseGroup(): Ast {
    this.#expect('(');
    if (this.#peek() === '?') {
      const next = this.source[this.#index + 1];
      if (next === ':') {
        this.#index += 2;
      } else if (next === '=' || next === '!' || next === '<') {
        this.#fail('lookaround is not supported; use unsafeRegex(...)');
      } else {
        this.#fail('unsupported group construct; use unsafeRegex(...)');
      }
    }
    const body = this.#parseAlt();
    if (this.#peek() !== ')') this.#fail('unterminated group');
    this.#index += 1;
    return body;
  }

  #parseClass(): Ast {
    this.#expect('[');
    let negated = false;
    if (this.#peek() === '^') {
      negated = true;
      this.#index += 1;
    }

    const ranges: CharRange[] = [];
    let first = true;
    while (!this.#done()) {
      if (this.#peek() === ']' && !first) {
        this.#index += 1;
        return { kind: 'char', matcher: { kind: 'class', negated, ranges } };
      }
      first = false;
      const start = this.#readClassChar();
      if (
        this.#peek() === '-' &&
        this.source[this.#index + 1] !== ']' &&
        this.source[this.#index + 1] !== undefined
      ) {
        this.#index += 1;
        const end = this.#readClassChar();
        if (start.length !== 1 || end.length !== 1)
          this.#fail('character-class ranges must use literal endpoints');
        const from = securityStringCharCodeAt(start, 0);
        const to = securityStringCharCodeAt(end, 0);
        if (from > to) this.#fail('character-class range is out of order');
        securityArrayPush(ranges, { from, to });
      } else {
        const atomRanges = classAtomRanges(start);
        for (let index = 0; index < atomRanges.length; index += 1) {
          securityArrayPush(ranges, atomRanges[index]!);
        }
      }
    }
    this.#fail('unterminated character class');
  }

  #readClassChar(): string {
    if (this.#peek() === '\\') {
      const atom = this.#parseEscape(true);
      if (atom.kind !== 'char' || atom.matcher.kind !== 'class' || atom.matcher.negated) {
        this.#fail('unsupported character-class escape');
      }
      return rangesToClassAtom(atom.matcher.ranges);
    }
    const ch = this.#peek();
    if (ch === undefined) this.#fail('unterminated character class');
    this.#index += 1;
    return ch;
  }

  #parseEscape(inClass: boolean): Ast {
    this.#expect('\\');
    const escaped = this.#peek();
    if (escaped === undefined) this.#fail('trailing escape');
    this.#index += 1;

    if (escaped === 'x' || escaped === 'u' || escaped === 'c') {
      this.#fail(`\\${escaped} escapes are not supported; use unsafeRegex(...)`);
    }
    if (escaped >= '1' && escaped <= '9') {
      this.#fail(
        inClass
          ? 'legacy numeric escapes in character classes are not supported; use unsafeRegex(...)'
          : 'backreferences are not supported; use unsafeRegex(...)',
      );
    }
    if (escaped === 'k') this.#fail('named backreferences are not supported; use unsafeRegex(...)');
    if (escaped === 'p' || escaped === 'P')
      this.#fail('unicode property escapes are not supported; use unsafeRegex(...)');
    if (!inClass && escaped === 'b') return { kind: 'anchor', anchor: 'word-boundary' };
    if (!inClass && escaped === 'B') return { kind: 'anchor', anchor: 'not-word-boundary' };
    if (inClass && escaped === 'b') return literal('\b');
    if (escaped === 'd') return charClass([{ from: 0x30, to: 0x39 }]);
    if (escaped === 'D') return charClass([{ from: 0x30, to: 0x39 }], true);
    if (escaped === 'w') return charClass(wordRanges());
    if (escaped === 'W') return charClass(wordRanges(), true);
    if (escaped === 's') return charClass(spaceRanges());
    if (escaped === 'S') return charClass(spaceRanges(), true);
    if (escaped === '0' && this.#peek() !== undefined && isDigit(this.#peekCode())) {
      this.#fail('octal escapes are not supported; use unsafeRegex(...)');
    }
    return literal(escapeValue(escaped));
  }

  #readQuantifier(): { min: number; max: number | null } | null {
    const ch = this.#peek();
    if (ch === '*') {
      this.#index += 1;
      return { min: 0, max: null };
    }
    if (ch === '+') {
      this.#index += 1;
      return { min: 1, max: null };
    }
    if (ch === '?') {
      this.#index += 1;
      return { min: 0, max: 1 };
    }
    if (ch !== '{') return null;

    const checkpoint = this.#index;
    this.#index += 1;
    const min = this.#readDecimal();
    if (min === null) {
      this.#index = checkpoint;
      return null;
    }
    let max: number | null = min;
    if (this.#peek() === ',') {
      this.#index += 1;
      max = this.#readDecimal();
    }
    if (this.#peek() !== '}') {
      this.#index = checkpoint;
      return null;
    }
    this.#index += 1;
    if (max !== null && max < min) this.#fail('repeat range is out of order');
    return { min, max };
  }

  #readDecimal(): number | null {
    let value = 0;
    let found = false;
    while (!this.#done() && isDigit(this.#peekCode())) {
      found = true;
      value = value * 10 + (this.#peekCode() - 0x30);
      if (value > DEFAULT_PROGRAM_SIZE_LIMIT)
        this.#fail('repeat count exceeds the linear-regex program cap');
      this.#index += 1;
    }
    return found ? value : null;
  }

  #expect(ch: string): void {
    if (this.#peek() !== ch) this.#fail(`expected "${ch}"`);
    this.#index += 1;
  }

  #peek(): string | undefined {
    return this.source[this.#index];
  }

  #peekCode(): number {
    return securityStringCharCodeAt(this.source, this.#index);
  }

  #done(): boolean {
    return this.#index >= this.source.length;
  }

  #fail(message: string): never {
    throw new LinearRegexError(`pattern(): ${message}`);
  }
}

class Compiler {
  readonly #instructions: Instruction[] = [];

  constructor(readonly limit: number) {}

  compile(ast: Ast): readonly Instruction[] {
    const unanchoredStart = this.#emit({ type: 'split', out: NO_OUT, out1: NO_OUT });
    const any = this.#emit({ type: 'char', matcher: { kind: 'any' }, out: unanchoredStart });
    const body = this.#compile(ast);
    const match = this.#emit({ type: 'match' });
    this.#instructions[unanchoredStart] = { type: 'split', out: body.start, out1: any };
    this.#patch(body.outs, match);
    return this.#instructions;
  }

  #compile(ast: Ast): Fragment {
    switch (ast.kind) {
      case 'empty': {
        const pc = this.#emit({ type: 'jmp', out: NO_OUT });
        return { start: pc, outs: [{ field: 'out', pc }] };
      }
      case 'char': {
        const pc = this.#emit({ type: 'char', matcher: ast.matcher, out: NO_OUT });
        return { start: pc, outs: [{ field: 'out', pc }] };
      }
      case 'anchor': {
        const pc = this.#emit({ type: 'assert', anchor: ast.anchor, out: NO_OUT });
        return { start: pc, outs: [{ field: 'out', pc }] };
      }
      case 'concat':
        return this.#compileConcat(ast.nodes);
      case 'alt': {
        let fragment: Fragment | null = null;
        for (let index = 0; index < ast.branches.length; index += 1) {
          const branch = ast.branches[index]!;
          const next = this.#compile(branch);
          if (!fragment) {
            fragment = next;
            continue;
          }
          const split = this.#emit({ type: 'split', out: fragment.start, out1: next.start });
          fragment = { start: split, outs: appendArrays(fragment.outs, next.outs) };
        }
        return fragment ?? this.#compile(empty());
      }
      case 'repeat':
        return this.#compileRepeat(ast);
    }
  }

  #compileConcat(nodes: readonly Ast[]): Fragment {
    let fragment: Fragment | null = null;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      const next = this.#compile(node);
      if (!fragment) {
        fragment = next;
      } else {
        this.#patch(fragment.outs, next.start);
        fragment = { start: fragment.start, outs: next.outs };
      }
    }
    return fragment ?? this.#compile(empty());
  }

  #compileRepeat(ast: Extract<Ast, { kind: 'repeat' }>): Fragment {
    if (ast.min === 0 && ast.max === 0) return this.#compile(empty());
    const pieces: Ast[] = [];
    for (let i = 0; i < ast.min; i += 1) securityArrayPush(pieces, ast.node);
    if (ast.max === null) {
      securityArrayPush(pieces, { kind: 'repeat', node: ast.node, min: 0, max: null });
      if (ast.min > 0) return this.#compileConcat(pieces);
      const body = this.#compile(ast.node);
      const split = this.#emit({ type: 'split', out: body.start, out1: NO_OUT });
      this.#patch(body.outs, split);
      return { start: split, outs: [{ field: 'out1', pc: split }] };
    }
    for (let i = ast.min; i < ast.max; i += 1) {
      securityArrayPush(pieces, { kind: 'repeat', node: ast.node, min: 0, max: 1 });
    }
    if (ast.min === 0 && ast.max === 1) {
      const body = this.#compile(ast.node);
      const split = this.#emit({ type: 'split', out: body.start, out1: NO_OUT });
      return {
        start: split,
        outs: appendArrays(body.outs, [{ field: 'out1', pc: split }]),
      };
    }
    return this.#compileConcat(pieces);
  }

  #emit(instruction: Instruction): number {
    if (this.#instructions.length >= this.limit) {
      throw new LinearRegexError(
        'pattern(): compiled program exceeds the linear-regex program cap; use unsafeRegex(...)',
      );
    }
    securityArrayPush(this.#instructions, instruction);
    return this.#instructions.length - 1;
  }

  #patch(outs: readonly Patch[], target: number): void {
    for (let index = 0; index < outs.length; index += 1) {
      const patch = outs[index]!;
      const instruction = this.#instructions[patch.pc];
      if (!instruction)
        throw new LinearRegexError('pattern(): internal compiler patch target missing');
      this.#instructions[patch.pc] = { ...instruction, [patch.field]: target } as Instruction;
    }
  }
}

interface Fragment {
  readonly outs: readonly Patch[];
  readonly start: number;
}

interface Patch {
  readonly field: 'out' | 'out1';
  readonly pc: number;
}

interface StateSet {
  count: number;
  matched: boolean;
  readonly seen: Uint8Array;
  readonly states: number[];
}

function createStateSet(size: number): StateSet {
  return { count: 0, matched: false, seen: securityCreateUint8Array(size), states: [] };
}

function resetStateSet(set: StateSet): void {
  set.count = 0;
  set.matched = false;
  securityUint8ArrayFill(set.seen, 0);
}

function addState(
  program: LinearRegexProgram,
  input: string,
  set: StateSet,
  startPc: number,
  position: number,
): void {
  const stack = [startPc];
  while (stack.length > 0) {
    const pc = stack[stack.length - 1] ?? 0;
    stack.length -= 1;
    if (pc < 0 || set.seen[pc]) continue;
    set.seen[pc] = 1;
    const instruction = program.instructions[pc];
    if (!instruction) continue;
    if (instruction.type === 'split') {
      securityArrayPush(stack, instruction.out1);
      securityArrayPush(stack, instruction.out);
    } else if (instruction.type === 'jmp') {
      securityArrayPush(stack, instruction.out);
    } else if (instruction.type === 'assert') {
      if (assertionPasses(program.flags, instruction.anchor, input, position)) {
        securityArrayPush(stack, instruction.out);
      }
    } else if (instruction.type === 'match') {
      set.matched = true;
    } else {
      set.states[set.count] = pc;
      set.count += 1;
    }
  }
}

function assertionPasses(
  flags: LinearRegexFlags,
  anchor: AnchorKind,
  input: string,
  position: number,
): boolean {
  if (anchor === 'begin')
    return (
      position === 0 ||
      (flags.multiline && isEcmaLineTerminatorAt(input, previousCodeUnitStart(input, position)))
    );
  if (anchor === 'end') {
    return (
      position === input.length ||
      (flags.multiline &&
        (isFinalLineTerminatorPosition(input, position) || isEcmaLineTerminatorAt(input, position)))
    );
  }
  const before = position > 0 ? securityStringCharCodeAt(input, position - 1) : -1;
  const after = position < input.length ? securityStringCharCodeAt(input, position) : -1;
  const boundary = isWordCode(before) !== isWordCode(after);
  return anchor === 'word-boundary' ? boundary : !boundary;
}

function matchesChar(matcher: CharMatcher, charCode: number, flags: LinearRegexFlags): boolean {
  if (matcher.kind === 'any') return true;
  if (matcher.kind === 'dot')
    return (
      flags.dotAll ||
      (charCode !== 0x0a && charCode !== 0x0d && charCode !== 0x2028 && charCode !== 0x2029)
    );
  const normalized = normalizeCode(charCode, flags);
  let found = false;
  for (let index = 0; index < matcher.ranges.length; index += 1) {
    const range = matcher.ranges[index]!;
    if (codeInClassRange(charCode, normalized, range, flags)) {
      found = true;
      break;
    }
  }
  return matcher.negated ? !found : found;
}

function parseFlags(flagsText: string): LinearRegexFlags {
  let dotAll = false;
  let ignoreCase = false;
  let multiline = false;
  const seen = createSecuritySet<string>();
  for (let index = 0; index < flagsText.length; index += 1) {
    const flag = securityStringSlice(flagsText, index, index + 1);
    if (securitySetHas(seen, flag)) throw new LinearRegexError('pattern(): duplicate regex flag');
    securitySetAdd(seen, flag);
    if (flag === 's') dotAll = true;
    else if (flag === 'i') ignoreCase = true;
    else if (flag === 'm') multiline = true;
    else if (flag === 'g' || flag === 'y') continue;
    else
      throw new LinearRegexError(
        `pattern(): regex flag "${flag}" is not supported; use unsafeRegex(...)`,
      );
  }
  return { dotAll, ignoreCase, multiline };
}

function containsNonAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (securityStringCharCodeAt(value, i) > 0x7f) return true;
  }
  return false;
}

function empty(): Ast {
  return { kind: 'empty' };
}

function literal(value: string): Ast {
  const code = securityStringCharCodeAt(value, 0);
  return charClass([{ from: code, to: code }]);
}

function charClass(ranges: readonly CharRange[], negated = false): Ast {
  return { kind: 'char', matcher: { kind: 'class', negated, ranges } };
}

function classAtomRanges(value: string): readonly CharRange[] {
  if (value.length === 1) {
    const code = securityStringCharCodeAt(value, 0);
    return [{ from: code, to: code }];
  }
  if (value === '\\d') return [{ from: 0x30, to: 0x39 }];
  if (value === '\\w') return wordRanges();
  if (value === '\\s') return spaceRanges();
  throw new LinearRegexError('pattern(): unsupported character-class atom');
}

function rangesToClassAtom(ranges: readonly CharRange[]): string {
  const range = ranges[0];
  if (range && ranges.length === 1 && range.from === range.to) {
    return securityStringFromCharCode(range.from);
  }
  if (sameRanges(ranges, [{ from: 0x30, to: 0x39 }])) return '\\d';
  if (sameRanges(ranges, wordRanges())) return '\\w';
  if (sameRanges(ranges, spaceRanges())) return '\\s';
  throw new LinearRegexError('pattern(): unsupported character-class escape');
}

function sameRanges(a: readonly CharRange[], b: readonly CharRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]?.from !== b[index]?.from || a[index]?.to !== b[index]?.to) return false;
  }
  return true;
}

function appendArrays<Value>(left: readonly Value[], right: readonly Value[]): Value[] {
  const combined: Value[] = [];
  for (let index = 0; index < left.length; index += 1) {
    securityArrayPush(combined, left[index]!);
  }
  for (let index = 0; index < right.length; index += 1) {
    securityArrayPush(combined, right[index]!);
  }
  return combined;
}

function escapeValue(value: string): string {
  if (value === 'n') return '\n';
  if (value === 'r') return '\r';
  if (value === 't') return '\t';
  if (value === 'f') return '\f';
  if (value === 'v') return '\v';
  if (value === '0') return '\0';
  return value;
}

function wordRanges(): readonly CharRange[] {
  return [
    { from: 0x30, to: 0x39 },
    { from: 0x41, to: 0x5a },
    { from: 0x5f, to: 0x5f },
    { from: 0x61, to: 0x7a },
  ];
}

function spaceRanges(): readonly CharRange[] {
  return [
    { from: 0x09, to: 0x0d },
    { from: 0x20, to: 0x20 },
    { from: 0xa0, to: 0xa0 },
    { from: 0x1680, to: 0x1680 },
    { from: 0x2000, to: 0x200a },
    { from: 0x2028, to: 0x2029 },
    { from: 0x202f, to: 0x202f },
    { from: 0x205f, to: 0x205f },
    { from: 0x3000, to: 0x3000 },
    { from: 0xfeff, to: 0xfeff },
  ];
}

function previousCodeUnitStart(input: string, position: number): number {
  if (position <= 0) return -1;
  if (
    position >= 2 &&
    securityStringCharCodeAt(input, position - 2) === 0x0d &&
    securityStringCharCodeAt(input, position - 1) === 0x0a
  ) {
    return position - 2;
  }
  return position - 1;
}

function isFinalLineTerminatorPosition(input: string, position: number): boolean {
  if (position === input.length - 1) {
    const code = securityStringCharCodeAt(input, position);
    return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
  }
  return (
    position === input.length - 2 &&
    securityStringCharCodeAt(input, position) === 0x0d &&
    securityStringCharCodeAt(input, position + 1) === 0x0a
  );
}

function isEcmaLineTerminatorAt(input: string, position: number): boolean {
  if (position < 0 || position >= input.length) return false;
  const code = securityStringCharCodeAt(input, position);
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

function normalizeCode(code: number, flags: LinearRegexFlags): number {
  if (!flags.ignoreCase) return code;
  if (code >= 0x41 && code <= 0x5a) return code + 0x20;
  return code;
}

function codeInClassRange(
  code: number,
  normalized: number,
  range: CharRange,
  flags: LinearRegexFlags,
): boolean {
  if (code >= range.from && code <= range.to) return true;
  if (!flags.ignoreCase) return false;
  if (normalized >= range.from && normalized <= range.to) return true;
  const folded = asciiCaseCounterpart(normalized);
  return folded >= range.from && folded <= range.to;
}

function asciiCaseCounterpart(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code + 0x20;
  if (code >= 0x61 && code <= 0x7a) return code - 0x20;
  return code;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isWordCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    code === 0x5f ||
    (code >= 0x61 && code <= 0x7a)
  );
}
