import type { Ast, CharMatcher, CharRange, LinearRegexFlags } from './index.js';

const UTF16_LIMIT = 0x1_0000;

/** Default hard cap for every finite-automata construction phase. */
export const DEFAULT_FINITE_AUTOMATA_STATE_BUDGET = 4_096;

/** @internal A total DFA over UTF-16 code units and a disjoint, exhaustive symbolic alphabet. */
export interface DeterministicFiniteAutomaton {
  readonly accepting: readonly boolean[];
  readonly alphabet: readonly CharRange[];
  readonly start: number;
  readonly transitions: readonly (readonly number[])[];
}

/** @internal State-explosion guard for analysis-only automata construction. */
export class FiniteAutomataStateBudgetError extends Error {
  readonly budget: number;
  readonly phase: 'dfa' | 'nfa' | 'product';

  constructor(phase: 'dfa' | 'nfa' | 'product', budget: number) {
    super(`finite automata ${phase} construction exceeded the hard ${budget}-state budget`);
    this.budget = budget;
    this.name = 'FiniteAutomataStateBudgetError';
    this.phase = phase;
  }
}

/** @internal Raised when a zero-width runtime matcher is used as a whole-string language. */
export class FiniteAutomataUnsupportedAstError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiniteAutomataUnsupportedAstError';
  }
}

interface NfaState {
  readonly epsilon: number[];
  readonly transitions: Array<{ readonly matcher: CharMatcher; readonly target: number }>;
}

interface Nfa {
  readonly accept: number;
  readonly flags: LinearRegexFlags;
  readonly start: number;
  readonly states: readonly NfaState[];
}

interface Fragment {
  readonly end: number;
  readonly start: number;
}

/** @internal Options shared by DFA and product construction. */
export interface FiniteAutomataOptions {
  readonly stateBudget?: number;
}

/**
 * Convert the production linear-regex AST into a total DFA by Thompson construction followed by
 * subset construction. Whole-string language semantics are implicit; anchors are rejected because
 * kABNF rules do not need them.
 */
export function determinizeAst(
  ast: Ast,
  flags: LinearRegexFlags = { dotAll: false, ignoreCase: false, multiline: false },
  options: FiniteAutomataOptions = {},
): DeterministicFiniteAutomaton {
  const budget = stateBudget(options);
  const nfa = buildNfa(ast, flags, budget);
  const alphabet = alphabetForNfa(nfa);
  const subsets: number[][] = [];
  const subsetByKey = new Map<string, number>();
  const accepting: boolean[] = [];
  const transitions: number[][] = [];
  const queue: number[] = [];

  function addSubset(states: readonly number[]): number {
    const closed = epsilonClosure(nfa, states);
    const key = closed.join(',');
    const existing = subsetByKey.get(key);
    if (existing !== undefined) return existing;
    if (subsets.length >= budget) throw new FiniteAutomataStateBudgetError('dfa', budget);
    const index = subsets.length;
    subsets.push(closed);
    subsetByKey.set(key, index);
    accepting.push(closed.includes(nfa.accept));
    transitions.push([]);
    queue.push(index);
    return index;
  }

  const start = addSubset([nfa.start]);
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const stateIndex = queue[queueIndex]!;
    const subset = subsets[stateIndex]!;
    const row = transitions[stateIndex]!;
    for (let symbolIndex = 0; symbolIndex < alphabet.length; symbolIndex += 1) {
      const code = alphabet[symbolIndex]!.from;
      const moved = new Set<number>();
      for (let subsetIndex = 0; subsetIndex < subset.length; subsetIndex += 1) {
        const state = nfa.states[subset[subsetIndex]!]!;
        for (let edgeIndex = 0; edgeIndex < state.transitions.length; edgeIndex += 1) {
          const edge = state.transitions[edgeIndex]!;
          if (matcherAccepts(edge.matcher, code, flags)) moved.add(edge.target);
        }
      }
      row.push(addSubset([...moved]));
    }
  }

  return { accepting, alphabet, start, transitions };
}

/** @internal Define a small reviewed DFA from a transition function. */
export function defineDfa(input: {
  readonly accepting: readonly number[];
  readonly alphabet: readonly CharRange[];
  readonly start: number;
  readonly stateCount: number;
  readonly transition: (state: number, code: number) => number;
}): DeterministicFiniteAutomaton {
  assertAlphabet(input.alphabet);
  if (!Number.isInteger(input.stateCount) || input.stateCount <= 0) {
    throw new TypeError('DFA stateCount must be a positive integer');
  }
  if (!Number.isInteger(input.start) || input.start < 0 || input.start >= input.stateCount) {
    throw new TypeError('DFA start state is outside the declared state set');
  }
  const accepting = Array.from({ length: input.stateCount }, () => false);
  for (const state of input.accepting) {
    if (!Number.isInteger(state) || state < 0 || state >= input.stateCount) {
      throw new TypeError('DFA accepting state is outside the declared state set');
    }
    accepting[state] = true;
  }
  const transitions: number[][] = [];
  for (let state = 0; state < input.stateCount; state += 1) {
    const row: number[] = [];
    for (const range of input.alphabet) {
      const target = input.transition(state, range.from);
      if (!Number.isInteger(target) || target < 0 || target >= input.stateCount) {
        throw new TypeError('DFA transition target is outside the declared state set');
      }
      row.push(target);
    }
    transitions.push(row);
  }
  return {
    accepting,
    alphabet: input.alphabet.map((range) => ({ ...range })),
    start: input.start,
    transitions,
  };
}

/** @internal Return the language complement of a total DFA. */
export function complementDfa(dfa: DeterministicFiniteAutomaton): DeterministicFiniteAutomaton {
  return {
    accepting: dfa.accepting.map((value) => !value),
    alphabet: dfa.alphabet,
    start: dfa.start,
    transitions: dfa.transitions,
  };
}

/** @internal Product construction with a caller-selected accepting relation. */
export function productDfa(
  left: DeterministicFiniteAutomaton,
  right: DeterministicFiniteAutomaton,
  accepts: (leftAccepts: boolean, rightAccepts: boolean) => boolean,
  options: FiniteAutomataOptions = {},
): DeterministicFiniteAutomaton {
  const budget = stateBudget(options);
  const alphabet = mergeAlphabets(left.alphabet, right.alphabet);
  const pairs: Array<readonly [number, number]> = [];
  const pairByKey = new Map<string, number>();
  const accepting: boolean[] = [];
  const transitions: number[][] = [];
  const queue: number[] = [];

  function addPair(leftState: number, rightState: number): number {
    const key = `${leftState}:${rightState}`;
    const existing = pairByKey.get(key);
    if (existing !== undefined) return existing;
    if (pairs.length >= budget) throw new FiniteAutomataStateBudgetError('product', budget);
    const index = pairs.length;
    pairs.push([leftState, rightState]);
    pairByKey.set(key, index);
    accepting.push(accepts(left.accepting[leftState]!, right.accepting[rightState]!));
    transitions.push([]);
    queue.push(index);
    return index;
  }

  const start = addPair(left.start, right.start);
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const productState = queue[queueIndex]!;
    const [leftState, rightState] = pairs[productState]!;
    const row = transitions[productState]!;
    for (const range of alphabet) {
      row.push(
        addPair(
          transitionForCode(left, leftState, range.from),
          transitionForCode(right, rightState, range.from),
        ),
      );
    }
  }

  return { accepting, alphabet, start, transitions };
}

/** @internal Intersection product. */
export function intersectDfa(
  left: DeterministicFiniteAutomaton,
  right: DeterministicFiniteAutomaton,
  options: FiniteAutomataOptions = {},
): DeterministicFiniteAutomaton {
  return productDfa(
    left,
    right,
    (leftAccepts, rightAccepts) => leftAccepts && rightAccepts,
    options,
  );
}

/** @internal Difference product, `L(left) \\ L(right)`. */
export function subtractDfa(
  left: DeterministicFiniteAutomaton,
  right: DeterministicFiniteAutomaton,
  options: FiniteAutomataOptions = {},
): DeterministicFiniteAutomaton {
  return productDfa(
    left,
    right,
    (leftAccepts, rightAccepts) => leftAccepts && !rightAccepts,
    options,
  );
}

/** @internal Whole-string membership in a total DFA. */
export function dfaAccepts(dfa: DeterministicFiniteAutomaton, value: string): boolean {
  let state = dfa.start;
  for (let index = 0; index < value.length; index += 1) {
    state = transitionForCode(dfa, state, value.charCodeAt(index));
  }
  return dfa.accepting[state]!;
}

/**
 * Return the shortest accepted UTF-16 string, choosing the smallest representative code unit among
 * equal-length witnesses. The visited-state bound makes this both a BFS emptiness decision and a
 * globally length-minimal counterexample extractor.
 */
export function shortestAcceptedString(dfa: DeterministicFiniteAutomaton): string | undefined {
  if (dfa.accepting[dfa.start]) return '';
  const visited = new Uint8Array(dfa.transitions.length);
  const previousState = new Int32Array(dfa.transitions.length);
  const previousCode = new Int32Array(dfa.transitions.length);
  visited[dfa.start] = 1;
  previousState.fill(-1);
  previousCode.fill(-1);
  const queue = [dfa.start];

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const state = queue[queueIndex]!;
    const row = dfa.transitions[state]!;
    for (let symbolIndex = 0; symbolIndex < dfa.alphabet.length; symbolIndex += 1) {
      const target = row[symbolIndex]!;
      if (visited[target]) continue;
      visited[target] = 1;
      previousState[target] = state;
      previousCode[target] = dfa.alphabet[symbolIndex]!.from;
      if (dfa.accepting[target]) {
        const codes: number[] = [];
        let cursor = target;
        while (cursor !== dfa.start) {
          codes.push(previousCode[cursor]!);
          cursor = previousState[cursor]!;
        }
        codes.reverse();
        let witness = '';
        for (const code of codes) witness += String.fromCharCode(code);
        return witness;
      }
      queue.push(target);
    }
  }
  return undefined;
}

/** @internal Result of a bounded language decision. */
export type LanguageDecision =
  | { readonly counterexample: string; readonly exploredStates: number; readonly holds: false }
  | { readonly exploredStates: number; readonly holds: true };

/** @internal Decide `L(left) ∩ L(right) = ∅` and return a shortest counterexample if false. */
export function decideDisjointness(
  left: DeterministicFiniteAutomaton,
  right: DeterministicFiniteAutomaton,
  options: FiniteAutomataOptions = {},
): LanguageDecision {
  return decisionFromCounterexample(intersectDfa(left, right, options));
}

/** @internal Decide `L(subset) ⊆ L(superset)` and return a shortest counterexample if false. */
export function decideContainment(
  subset: DeterministicFiniteAutomaton,
  superset: DeterministicFiniteAutomaton,
  options: FiniteAutomataOptions = {},
): LanguageDecision {
  return decisionFromCounterexample(subtractDfa(subset, superset, options));
}

function decisionFromCounterexample(dfa: DeterministicFiniteAutomaton): LanguageDecision {
  const counterexample = shortestAcceptedString(dfa);
  return counterexample === undefined
    ? { exploredStates: dfa.transitions.length, holds: true }
    : { counterexample, exploredStates: dfa.transitions.length, holds: false };
}

function buildNfa(ast: Ast, flags: LinearRegexFlags, budget: number): Nfa {
  const states: NfaState[] = [];

  function state(): number {
    if (states.length >= budget) throw new FiniteAutomataStateBudgetError('nfa', budget);
    states.push({ epsilon: [], transitions: [] });
    return states.length - 1;
  }

  function fragment(node: Ast): Fragment {
    if (node.kind === 'anchor') {
      throw new FiniteAutomataUnsupportedAstError(
        `finite language DFA does not accept the ${node.anchor} zero-width assertion`,
      );
    }
    if (node.kind === 'empty') {
      const start = state();
      const end = state();
      states[start]!.epsilon.push(end);
      return { end, start };
    }
    if (node.kind === 'char') {
      const start = state();
      const end = state();
      states[start]!.transitions.push({ matcher: node.matcher, target: end });
      return { end, start };
    }
    if (node.kind === 'concat') {
      if (node.nodes.length === 0) return fragment({ kind: 'empty' });
      const first = fragment(node.nodes[0]!);
      let end = first.end;
      for (let index = 1; index < node.nodes.length; index += 1) {
        const next = fragment(node.nodes[index]!);
        states[end]!.epsilon.push(next.start);
        end = next.end;
      }
      return { end, start: first.start };
    }
    if (node.kind === 'alt') {
      const start = state();
      const end = state();
      if (node.branches.length === 0) states[start]!.epsilon.push(end);
      for (const branch of node.branches) {
        const child = fragment(branch);
        states[start]!.epsilon.push(child.start);
        states[child.end]!.epsilon.push(end);
      }
      return { end, start };
    }

    const start = state();
    let tail = start;
    for (let count = 0; count < node.min; count += 1) {
      const required = fragment(node.node);
      states[tail]!.epsilon.push(required.start);
      tail = required.end;
    }
    if (node.max === null) {
      const end = state();
      const repeated = fragment(node.node);
      states[tail]!.epsilon.push(end, repeated.start);
      states[repeated.end]!.epsilon.push(tail);
      return { end, start };
    }
    for (let count = node.min; count < node.max; count += 1) {
      const nextTail = state();
      const optional = fragment(node.node);
      states[tail]!.epsilon.push(nextTail, optional.start);
      states[optional.end]!.epsilon.push(nextTail);
      tail = nextTail;
    }
    return { end: tail, start };
  }

  const built = fragment(ast);
  return { accept: built.end, flags, start: built.start, states };
}

function epsilonClosure(nfa: Nfa, seeds: readonly number[]): number[] {
  const seen = new Uint8Array(nfa.states.length);
  const stack = [...seeds];
  const closed: number[] = [];
  while (stack.length > 0) {
    const state = stack.pop()!;
    if (seen[state]) continue;
    seen[state] = 1;
    closed.push(state);
    for (const target of nfa.states[state]!.epsilon) stack.push(target);
  }
  closed.sort((left, right) => left - right);
  return closed;
}

function alphabetForNfa(nfa: Nfa): CharRange[] {
  const endpoints = new Set<number>([0, UTF16_LIMIT]);
  for (const state of nfa.states) {
    for (const edge of state.transitions) addMatcherEndpoints(endpoints, edge.matcher, nfa.flags);
  }
  return rangesFromEndpoints(endpoints);
}

function addMatcherEndpoints(
  endpoints: Set<number>,
  matcher: CharMatcher,
  flags: LinearRegexFlags,
): void {
  if (matcher.kind === 'dot' && !flags.dotAll) {
    for (const code of [0x0a, 0x0d, 0x2028, 0x2029]) addRangeEndpoints(endpoints, code, code);
    return;
  }
  if (matcher.kind !== 'class') return;
  for (const range of matcher.ranges) {
    addRangeEndpoints(endpoints, range.from, range.to);
    if (!flags.ignoreCase) continue;
    addFoldedAsciiEndpoints(endpoints, range.from, range.to, 0x41, 0x5a, 0x20);
    addFoldedAsciiEndpoints(endpoints, range.from, range.to, 0x61, 0x7a, -0x20);
  }
}

function addFoldedAsciiEndpoints(
  endpoints: Set<number>,
  from: number,
  to: number,
  alphabetFrom: number,
  alphabetTo: number,
  offset: number,
): void {
  const intersectionFrom = Math.max(from, alphabetFrom);
  const intersectionTo = Math.min(to, alphabetTo);
  if (intersectionFrom <= intersectionTo) {
    addRangeEndpoints(endpoints, intersectionFrom + offset, intersectionTo + offset);
  }
}

function addRangeEndpoints(endpoints: Set<number>, from: number, to: number): void {
  const boundedFrom = Math.max(0, Math.min(UTF16_LIMIT - 1, from));
  const boundedTo = Math.max(0, Math.min(UTF16_LIMIT - 1, to));
  if (boundedFrom > boundedTo) return;
  endpoints.add(boundedFrom);
  endpoints.add(boundedTo + 1);
}

function rangesFromEndpoints(endpoints: ReadonlySet<number>): CharRange[] {
  const sorted = [...endpoints].sort((left, right) => left - right);
  const ranges: CharRange[] = [];
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const from = sorted[index]!;
    const to = sorted[index + 1]! - 1;
    if (from <= to) ranges.push({ from, to });
  }
  assertAlphabet(ranges);
  return ranges;
}

function matcherAccepts(matcher: CharMatcher, code: number, flags: LinearRegexFlags): boolean {
  if (matcher.kind === 'any') return true;
  if (matcher.kind === 'dot') {
    return flags.dotAll || (code !== 0x0a && code !== 0x0d && code !== 0x2028 && code !== 0x2029);
  }
  const direct = matcher.ranges.some((range) => code >= range.from && code <= range.to);
  let folded = false;
  if (flags.ignoreCase) {
    const counterpart =
      code >= 0x41 && code <= 0x5a
        ? code + 0x20
        : code >= 0x61 && code <= 0x7a
          ? code - 0x20
          : code;
    folded = matcher.ranges.some((range) => counterpart >= range.from && counterpart <= range.to);
  }
  const found = direct || folded;
  return matcher.negated ? !found : found;
}

function mergeAlphabets(left: readonly CharRange[], right: readonly CharRange[]): CharRange[] {
  const endpoints = new Set<number>([0, UTF16_LIMIT]);
  for (const range of [...left, ...right]) addRangeEndpoints(endpoints, range.from, range.to);
  return rangesFromEndpoints(endpoints);
}

function transitionForCode(dfa: DeterministicFiniteAutomaton, state: number, code: number): number {
  let low = 0;
  let high = dfa.alphabet.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = dfa.alphabet[middle]!;
    if (code < range.from) high = middle - 1;
    else if (code > range.to) low = middle + 1;
    else return dfa.transitions[state]![middle]!;
  }
  throw new TypeError('DFA input is outside the UTF-16 alphabet');
}

function assertAlphabet(alphabet: readonly CharRange[]): void {
  let expectedFrom = 0;
  for (const range of alphabet) {
    if (range.from !== expectedFrom || range.to < range.from || range.to >= UTF16_LIMIT) {
      throw new TypeError('DFA alphabet must be ordered, disjoint, and exhaustive over UTF-16');
    }
    expectedFrom = range.to + 1;
  }
  if (expectedFrom !== UTF16_LIMIT) {
    throw new TypeError('DFA alphabet must be ordered, disjoint, and exhaustive over UTF-16');
  }
}

function stateBudget(options: FiniteAutomataOptions): number {
  const budget = options.stateBudget ?? DEFAULT_FINITE_AUTOMATA_STATE_BUDGET;
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new TypeError('finite automata stateBudget must be a positive integer');
  }
  return budget;
}
