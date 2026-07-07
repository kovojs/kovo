// SPEC §6.6 / KV434: shared ReDoS classifier corpus for the runtime and compiler twins.

export interface RedosCorpusCase {
  readonly name: string;
  readonly source: string;
}

export const REDOS_UNSUPPORTED_CORPUS: readonly RedosCorpusCase[] = [
  { name: 'hex escape', source: '\\x41' },
  { name: 'unicode escape', source: '\\u0041' },
  { name: 'unicode code point escape', source: '\\u{41}' },
  { name: 'control escape', source: '\\cA' },
  { name: 'positive lookahead', source: '(?=a)a' },
  { name: 'negative lookahead', source: '(?!a).' },
  { name: 'positive lookbehind', source: '(?<=a)b' },
  { name: 'negative lookbehind', source: '(?<!a)b' },
  { name: 'numbered backreference', source: '(a)\\1' },
  { name: 'named backreference', source: '(?<word>a)\\k<word>' },
  { name: 'unicode property escape', source: '\\p{Letter}+' },
] as const;

export const REDOS_LINEAR_ADVERSARIAL_CORPUS: readonly RedosCorpusCase[] = [
  { name: 'nested plus', source: '(a+)+' },
  { name: 'nested star', source: '(a*)*' },
  { name: 'nested plus under star', source: '(a+)*' },
  { name: 'nested optional pair', source: '(a?b?)+$' },
  { name: 'nested optional fixed repeat', source: '(a?){50}b' },
  { name: 'nested optional single', source: '(a?)+' },
  { name: 'inner quantified capture under quantified capture', source: '((a+))+' },
  { name: 'inner quantified nested capture', source: '(a(b+))+' },
  { name: 'inner quantified class under quantified capture', source: '(([a-z]+))+' },
  { name: 'inner quantified escape under quantified star', source: '((\\d+))*' },
  { name: 'nested quantified group under quantified group', source: '((ab)+)+' },
  { name: 'class containing right paren', source: '([)]+)+' },
  { name: 'escaped class containing right paren', source: '([\\w)]+)+' },
  { name: 'anchored class containing right paren', source: '^([\\w)]+)+$' },
  { name: 'overlapping identical alternatives', source: '^(a|a)*$' },
  { name: 'overlapping prefix alternatives', source: '^(a|aa)+$' },
  { name: 'overlapping class alternative', source: '^([a-z]|a)+$' },
  { name: 'nested identical alternatives under quantified group', source: '((a|a))+' },
  {
    name: 'nested overlapping class alternatives under quantified group',
    source: '(([ab]|[bc]))+',
  },
  { name: 'deeply nested identical alternatives under quantified group', source: '(((a|a)))+' },
  { name: 'nested identical alternatives under braced quantified group', source: '((a|a)){1,}' },
  { name: 'adjacent digit quantifiers', source: '\\d+\\d+' },
  { name: 'adjacent star quantifiers', source: 'a*a*' },
  { name: 'adjacent class quantifiers', source: '[a-z]+[a-z]*' },
] as const;

export const REDOS_PARITY_CORPUS: readonly RedosCorpusCase[] = [
  { name: 'flat class anchor', source: '^[a-z0-9]+$' },
  { name: 'date digits', source: '\\d{4}-\\d{2}-\\d{2}' },
  { name: 'disjoint literal alternatives', source: '^(cat|dog|bird)$' },
  { name: 'plain literal', source: 'hello' },
  { name: 'optional group without outer quantifier', source: '(a?b?)' },
  { name: 'flat optional run', source: 'a?b?c?' },
  { name: 'anchored optional group without outer quantifier', source: '^(a?b?)$' },
  { name: 'quantified non-capturing group with unquantified body', source: '(?:ab)+' },
  { name: 'nested unquantified capture under quantified group', source: '((ab))+' },
  { name: 'nested non-capturing group under quantified group', source: '((?:ab))+' },
  { name: 'disjoint alternatives under quantified group', source: '(a|b)+' },
  { name: 'empty alternative', source: '(a|)+' },
  { name: 'empty group', source: '()' },
  { name: 'word boundary', source: '\\bcat\\b' },
  { name: 'not word boundary', source: '\\Bcat' },
  { name: 'dotall candidate', source: 'a.b' },
  { name: 'case insensitive candidate', source: 'abc' },
] as const;
