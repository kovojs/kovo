import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { analyzeCapabilityClosure } from '../security/capability-closure.js';
import type {
  CapabilityClosureSourceFile,
  ScannedBindingCandidate,
  ScannedImportBindingFact,
} from '../security/capability-closure-model.js';
import {
  lexicalCallKey,
  scanLexicalProvenance,
  type ScannedUseProvenance,
} from './lexical-provenance.js';

interface SourceAnalysis {
  readonly call: (callee: string) => ScannedUseProvenance;
}

function analyzeSource(source: string): SourceAnalysis {
  const sourceFile = ts.createSourceFile(
    'app.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports: ScannedImportBindingFact[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name) {
      imports.push({
        imported: 'default',
        local: clause.name.text,
        specifier: statement.moduleSpecifier.text,
      });
    }
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      imports.push({
        imported: '*',
        local: named.name.text,
        namespace: true,
        specifier: statement.moduleSpecifier.text,
      });
    } else if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        imports.push({
          imported: element.propertyName?.text ?? element.name.text,
          local: element.name.text,
          specifier: statement.moduleSpecifier.text,
        });
      }
    }
  }
  const result = scanLexicalProvenance(sourceFile, imports);
  return {
    call(callee: string): ScannedUseProvenance {
      const matches: ts.CallExpression[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === callee) {
          matches.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      expect(matches, `one call to ${callee}`).toHaveLength(1);
      const fact = result.calls.get(lexicalCallKey(matches[0]!, sourceFile))?.callee;
      expect(fact, `lexical provenance for ${callee}`).toBeDefined();
      return fact!;
    },
  };
}

function hasCandidate(
  fact: ScannedUseProvenance,
  predicate: (candidate: ScannedBindingCandidate) => boolean,
): boolean {
  return fact.candidates.some(predicate);
}

function isImport(candidate: ScannedBindingCandidate, imported: string): boolean {
  return candidate.kind === 'import' && candidate.exportName === imported;
}

describe('SPEC §6.6 JSX lexical provenance', () => {
  it('keeps a local generator invocation distinct from imported framework roots', () => {
    const { call } = analyzeSource(`
      import { createApp, publicAccess, route } from '@kovojs/server';
      const safe = route('/', {
        access: publicAccess('local generator provenance'),
        page() {
          function* values() { yield 'safe'; }
          return [...values()].join(',');
        },
      });
      export default createApp({ routes: [safe] });
    `);

    expect(call('values')).toEqual({
      candidates: [{ exportName: 'values', kind: 'local' }],
      rootWideningRequired: false,
      uncertain: false,
    });
  });

  it('records exact call provenance inside JSX children, attributes, and nested fragments', () => {
    const { call } = analyzeSource(`
      import { Badge } from '@kovojs/ui/badge';
      import { Button } from '@kovojs/ui/button';
      import { Card } from '@kovojs/ui/card';
      const view = (
        <Card child={<><span>{Badge({ children: 'B' })}</span></>}>
          {Button({ children: 'Save' })}
        </Card>
      );
      void view;
    `);

    expect(call('Badge')).toEqual({
      candidates: [
        {
          exportName: 'Badge',
          kind: 'import',
          members: [],
          specifier: '@kovojs/ui/badge',
        },
      ],
      rootWideningRequired: false,
      uncertain: false,
    });
    expect(call('Button')).toEqual({
      candidates: [
        {
          exportName: 'Button',
          kind: 'import',
          members: [],
          specifier: '@kovojs/ui/button',
        },
      ],
      rootWideningRequired: false,
      uncertain: false,
    });
  });

  it.each([
    {
      label: 'child expression',
      jsx: '<div>{(make = route, null)}</div>',
    },
    {
      label: 'attribute expression',
      jsx: '<div title={(make = route, "title")} />',
    },
    {
      label: 'nested fragment',
      jsx: '<div child={<><span>{(make = route, null)}</span></>} />',
    },
  ])('retains a root assignment hidden in a JSX $label', ({ jsx }) => {
    const { call } = analyzeSource(`
      import { route } from '@kovojs/server';
      function localFactory() { return null; }
      let make = localFactory;
      const view = ${jsx};
      make('/hidden-root', { render() { return null; } });
      void view;
    `);

    const fact = call('make');
    expect(hasCandidate(fact, (candidate) => isImport(candidate, 'route'))).toBe(true);
  });

  it('closes raw process authority reached from a route root assigned inside JSX', () => {
    const result = analyzeCapabilityClosure({
      files: [
        {
          fileName: 'app.tsx',
          source: `
            import { route } from '@kovojs/server';
            function localFactory() { return null; }
            let make = localFactory;
            const view = <div>{(make = route, null)}</div>;
            export const page = make('/hidden-process-root', {
              render() { return process.env.SECRET; },
            });
            void view;
          `,
        },
      ],
    });

    expect(result.facts).toContainEqual(
      expect.objectContaining({
        capability: 'process',
        kind: 'closed',
        name: '/hidden-process-root',
        rootKind: 'route',
      }),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('KV448');
  });

  it('evaluates JSX props before the component invocation can write root provenance', () => {
    const { call } = analyzeSource(`
      import { route } from '@kovojs/server';
      function localFactory() { return null; }
      let make = localFactory;
      function Installer() { make = route; return null; }
      const view = <Installer value={(make = localFactory)} />;
      make('/component-write', { render() { return null; } });
      void view;
    `);

    const fact = call('make');
    expect(hasCandidate(fact, (candidate) => isImport(candidate, 'route'))).toBe(true);
  });

  it('does not retain a prop write that the later component invocation definitely replaces', () => {
    const { call } = analyzeSource(`
      import { route } from '@kovojs/server';
      function localFactory() { return null; }
      let make = localFactory;
      function Reset() { make = localFactory; return null; }
      const view = <Reset value={(make = route)} />;
      make('/not-a-root', { render() { return null; } });
      void view;
    `);

    const fact = call('make');
    expect(hasCandidate(fact, (candidate) => isImport(candidate, 'route'))).toBe(false);
    expect(hasCandidate(fact, (candidate) => candidate.kind === 'local')).toBe(true);
  });

  it('invokes the component value snapshotted before props reassign its tag binding', () => {
    const { call } = analyzeSource(`
      import { route } from '@kovojs/server';
      function localFactory() { return null; }
      let make = localFactory;
      function Installer() { make = route; return null; }
      function Reset() { make = localFactory; return null; }
      let View = Installer;
      const view = <View value={(View = Reset)} />;
      make('/snapshotted-component', { render() { return null; } });
      void view;
    `);

    const fact = call('make');
    expect(hasCandidate(fact, (candidate) => isImport(candidate, 'route'))).toBe(true);
  });

  it('does not invoke a component value assigned only after tag evaluation', () => {
    const { call } = analyzeSource(`
      import { route } from '@kovojs/server';
      function localFactory() { return null; }
      let make = localFactory;
      function Installer() { make = route; return null; }
      function Reset() { make = localFactory; return null; }
      let View = Reset;
      const view = <View value={(View = Installer)} />;
      make('/later-component-not-invoked', { render() { return null; } });
      void view;
    `);

    const fact = call('make');
    expect(hasCandidate(fact, (candidate) => isImport(candidate, 'route'))).toBe(false);
    expect(hasCandidate(fact, (candidate) => candidate.kind === 'local')).toBe(true);
  });

  it('fails closed across getter-bearing JSX spread effects', () => {
    const { call } = analyzeSource(`
      import { route } from '@kovojs/server';
      function localFactory() { return null; }
      function View() { return null; }
      let make = localFactory;
      const props = { get value() { make = route; return 'value'; } };
      const view = <View {...props} />;
      make('/spread-getter-root', { render() { return null; } });
      void view;
    `);

    const fact = call('make');
    expect(
      hasCandidate(fact, (candidate) => isImport(candidate, 'route')) || fact.rootWideningRequired,
    ).toBe(true);
  });

  it('keeps exact reviewed root-free framework receiver chains out of root widening', () => {
    const { call } = analyzeSource(`
      import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules'
      import { s } from '@kovojs/server';
      const clientModules = createMemoryVersionedClientModuleRegistry();
      clientModules.put({ source: 'export const value = 1;' });
      const count = s.number().int().min(1).default(1);
      void count;
    `);

    for (const callee of [
      'clientModules.put',
      's.number().int',
      's.number().int().min',
      's.number().int().min(1).default',
    ]) {
      const fact = call(callee);
      expect(fact.rootWideningRequired, callee).toBe(false);
      expect(
        fact.candidates.some((candidate) => candidate.kind === 'unknown'),
        callee,
      ).toBe(false);
    }
  });

  it('keeps an unreviewed framework call result root-bearing by default', () => {
    const { call } = analyzeSource(`
      import { futureHelper } from '@kovojs/server';
      const maybeFactory = futureHelper();
      maybeFactory('/must-stay-closed', { render() { return null; } });
    `);

    const fact = call('maybeFactory');
    expect(fact.rootWideningRequired).toBe(true);
    expect(fact.candidates).toContainEqual(expect.objectContaining({ kind: 'unknown' }));
  });

  it('does not launder a root-bearing argument through a reviewed receiver transition', () => {
    const { call } = analyzeSource(`
      import { route, s } from '@kovojs/server';
      const schema = s.number().default(route);
      schema.parse(undefined);
    `);

    expect(call('schema.parse').rootWideningRequired).toBe(true);
  });

  it('keeps unknown reviewed-receiver members root-bearing by default', () => {
    const { call } = analyzeSource(`
      import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules';
      const clientModules = createMemoryVersionedClientModuleRegistry();
      clientModules.futureMethod();
    `);

    expect(call('clientModules.futureMethod').rootWideningRequired).toBe(true);
  });

  it('does not let a reviewed receiver token survive a mutable root-factory overwrite', () => {
    const { call } = analyzeSource(`
      import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules'
      import { route } from '@kovojs/server';
      let clientModules = createMemoryVersionedClientModuleRegistry();
      clientModules = route;
      clientModules.put({ source: 'export const value = 1;' });
    `);

    const fact = call('clientModules.put');
    expect(fact.rootWideningRequired).toBe(true);
    expect(hasCandidate(fact, (candidate) => isImport(candidate, 'route'))).toBe(true);
  });

  it('does not invent query or mutation roots at safe real-app-shaped JSX calls', () => {
    const files: CapabilityClosureSourceFile[] = [
      {
        fileName: 'mutations.ts',
        source: `
          import { mutation } from '@kovojs/server';
          export const addContact = mutation('contacts/add', { run() { return null; } });
        `,
      },
      {
        fileName: 'queries.ts',
        source: `
          import { query } from '@kovojs/server';
          export const contactsQuery = query('contacts/list', { load() { return { items: [] }; } });
        `,
      },
      {
        fileName: 'contacts.tsx',
        source: `
          import { component } from '@kovojs/core';
          import { mutationFormAttributes } from '@kovojs/server';
          import { Badge } from '@kovojs/ui/badge';
          import { Button } from '@kovojs/ui/button';
          import { addContact } from './mutations.js';
          import { contactsQuery } from './queries.js';
          function renderContactCard(contact) {
            return <li>{Badge({ children: contact.company })}</li>;
          }
          export const Contacts = component({
            mutations: { addContact },
            queries: { contacts: contactsQuery },
            render: ({ contacts }) => (
              <div>
                {Badge({ children: String(contacts.items.length) })}
                <form {...mutationFormAttributes(addContact)}>
                  {Button({ children: 'Add', type: 'submit' })}
                </form>
                <ul>{contacts.items.map((contact) => renderContactCard(contact))}</ul>
              </div>
            ),
          });
        `,
      },
    ];
    const result = analyzeCapabilityClosure({ files });

    const phantomRoots = result.facts.filter(
      (fact) =>
        fact.kind === 'root' &&
        fact.module === 'contacts.tsx' &&
        (fact.rootKind === 'mutation' || fact.rootKind === 'query'),
    );
    expect(phantomRoots).toEqual([]);
  });
});
