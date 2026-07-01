export const DEC10_CORPUS_DIALECTS = ['pglite', 'better-sqlite3'] as const;

export type Dec10CorpusDialect = (typeof DEC10_CORPUS_DIALECTS)[number];

export type Dec10CorpusFamily = 'import-alias' | 'sql' | 'taint-expression';

export interface Dec10AdversarialSeed {
  family: Dec10CorpusFamily;
  id: string;
  payloads: readonly string[];
}

export interface Dec10GreenCompilerCase {
  family: Exclude<Dec10CorpusFamily, 'sql'>;
  id: string;
  source: string;
}

export interface Dec10GreenSqlCase {
  id: string;
  statement:
    | { kind: 'identifier'; value: string; allow: readonly string[] }
    | { kind: 'keyword'; value: string; allow: readonly string[] }
    | { kind: 'separated-carrier'; text: string; values: readonly unknown[] }
    | { kind: 'static-sql'; text: string }
    | { kind: 'trusted-sql'; justification: string; text: string };
}

export interface Dec10GreenCorpusRow {
  dialect: Dec10CorpusDialect;
  family: Dec10CorpusFamily;
  id: string;
  source?: string;
  statement?: Dec10GreenSqlCase['statement'];
}

export const dec10AdversarialSeeds: readonly Dec10AdversarialSeed[] = [
  {
    family: 'sql',
    id: 'sql-identifier-and-assembly-payloads',
    payloads: [
      'products; drop table products; --',
      'orders where 1=1',
      'name desc; vacuum',
      '/*comment*/users',
    ],
  },
  {
    family: 'taint-expression',
    id: 'request-query-taint-preserving-expressions',
    payloads: [
      "request.headers.get('x-xss') ?? ''",
      'post.body.trim()',
      'renderCard(post.body)',
      '({ body: post.body }).body',
    ],
  },
  {
    family: 'import-alias',
    id: 'trusted-output-import-alias-shapes',
    payloads: [
      "import { trustedHtml as th } from '@kovojs/browser'; th(value)",
      "import * as browser from '@kovojs/browser'; browser.trustedHtml(value)",
      'const trust = { html: trustedHtml }; trust.html(value)',
      "export { trustedHtml as th } from '@kovojs/browser';",
    ],
  },
];

export const dec10GreenCompilerCases: readonly Dec10GreenCompilerCase[] = [
  {
    family: 'taint-expression',
    id: 'literal-trusted-html',
    source: `
import { trustedHtml } from '@kovojs/browser';
export const C = component({ render: () => <article>{trustedHtml('<p>reviewed</p>')}</article> });
`,
  },
  {
    family: 'taint-expression',
    id: 'audited-request-trusted-html',
    source: `
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request }) => (
    <article>{trustedHtml(request.headers.get('x-reviewed') ?? '', 'reviewed upstream CMS')}</article>
  ),
});
`,
  },
  {
    family: 'taint-expression',
    id: 'safe-rich-html-query-data',
    source: `
import { safeRichHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{safeRichHtml(post.body)}</article>,
});
`,
  },
  {
    family: 'import-alias',
    id: 'trusted-html-import-alias-literal',
    source: `
import { trustedHtml as th } from '@kovojs/browser';
export const C = component({ render: () => <article>{th('<p>reviewed alias</p>')}</article> });
`,
  },
];

export const dec10GreenSqlCases: readonly Dec10GreenSqlCase[] = [
  {
    id: 'separated-select-carrier',
    statement: {
      kind: 'separated-carrier',
      text: 'select * from products where id = $1',
      values: ['p1'],
    },
  },
  { id: 'static-select', statement: { kind: 'static-sql', text: 'select * from products' } },
  {
    id: 'trusted-reviewed-order',
    statement: {
      kind: 'trusted-sql',
      justification: 'static admin report reviewed in DEC10 green corpus',
      text: 'select * from products order by name',
    },
  },
  {
    id: 'allowlisted-identifier',
    statement: { kind: 'identifier', value: 'products', allow: ['products', 'orders'] },
  },
  {
    id: 'allowlisted-keyword',
    statement: { kind: 'keyword', value: 'asc', allow: ['asc', 'desc'] },
  },
];

export function dec10GreenCorpusRows(): Dec10GreenCorpusRow[] {
  return DEC10_CORPUS_DIALECTS.flatMap((dialect) => [
    ...dec10GreenCompilerCases.map((entry) => ({
      dialect,
      family: entry.family,
      id: entry.id,
      source: entry.source,
    })),
    ...dec10GreenSqlCases.map((entry) => ({
      dialect,
      family: 'sql' as const,
      id: entry.id,
      statement: entry.statement,
    })),
  ]);
}
