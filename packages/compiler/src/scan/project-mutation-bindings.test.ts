import { describe, expect, it } from 'vitest';

import { compileComponentModule } from '../index.js';
import type { ProjectMutationSourceFile } from './project-mutation-bindings.js';
import { projectMutationRegistryFactsFromFiles } from './project-mutation-bindings.js';

// @kovo-security-classifier-corpus mutation-form-project-provenance

const mutationSource = `
import { mutation, s } from '@kovojs/server';

export const addContact = mutation({
  input: s.object({
    company: s.string(),
    email: s.string(),
    name: s.string(),
  }),
  handler(input) { return input; },
});
`;

const authFactorySource = `
import { createBetterAuthPostgresBindingsFromEnvironment } from '@kovojs/better-auth';

export function createAppAuthBindings(options: Record<string, unknown>) {
  return createBetterAuthPostgresBindingsFromEnvironment({ ...options });
}
`;

const authSource = `
import { createAppAuthBindings } from './_kovo/app-runtime-db.js';

const authBindings = createAppAuthBindings({ csrf: {}, signInAccess: {}, signOutAccess: {} });
export const appSignIn = authBindings.signIn;
export const appSignOut = authBindings.signOut;
`;

const stockFormsSource = `
import { component, FormError } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { appSignIn, appSignOut } from '../auth.js';
import { addContact } from '../mutations-barrel.js';

export const StockForms = component({
  mutations: { addContact, appSignIn, appSignOut },
  render: () => <>
    <form mutation={appSignIn}>
      <input name="email" />
      <input name="password" />
      <input name="next" />
      <FormError code="INVALID_CREDENTIALS" message="Invalid credentials" />
    </form>
    <form {...mutationFormAttributes(addContact)}>
      <input name="company" />
      <input name="email" />
      <input name="name" />
      <FormError code="DUPLICATE_EMAIL" message="Duplicate" />
    </form>
    <form mutation={appSignOut}><button type="submit">Sign out</button></form>
  </>,
});
`;

function stockFiles(
  replacements: Readonly<Record<string, string>> = {},
): ProjectMutationSourceFile[] {
  const defaults: Readonly<Record<string, string>> = {
    '_kovo/app-runtime-db.ts': authFactorySource,
    'auth.ts': authSource,
    'components/forms.tsx': stockFormsSource,
    'mutations-barrel.ts': `export { addContact } from './mutations.js';`,
    'mutations.ts': mutationSource,
  };
  const names = new Set([...Object.keys(defaults), ...Object.keys(replacements)]);
  return [...names].flatMap((fileName) => {
    const source = replacements[fileName] ?? defaults[fileName];
    return source === undefined ? [] : [{ fileName, source }];
  });
}

function bindingNames(files: readonly ProjectMutationSourceFile[]): string[] {
  return projectMutationRegistryFactsFromFiles(files)
    .mutationBindings.filter((binding) => binding.fileName === 'components/forms.tsx')
    .map((binding) => binding.localName)
    .sort();
}

describe('project mutation-form provenance', () => {
  it('accepts stock mutation and generated Better Auth forms through exact relative chains', () => {
    const files = stockFiles();
    const facts = projectMutationRegistryFactsFromFiles(files);

    expect(bindingNames(files)).toEqual(['addContact', 'appSignIn', 'appSignOut']);
    expect(facts.mutationBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'components/forms.tsx',
          key: 'mutations/add-contact',
          localName: 'addContact',
          source: expect.objectContaining({ kind: 'kovo-mutation' }),
        }),
        expect.objectContaining({
          fileName: 'components/forms.tsx',
          key: 'auth/sign-in',
          localName: 'appSignIn',
          source: expect.objectContaining({ kind: 'better-auth-sign-in' }),
        }),
        expect.objectContaining({
          fileName: 'components/forms.tsx',
          key: 'auth/sign-out',
          localName: 'appSignOut',
          source: expect.objectContaining({ kind: 'better-auth-sign-out' }),
        }),
      ]),
    );
    expect(facts.mutationInputs['mutations/add-contact']?.map((field) => field.name)).toEqual([
      'company',
      'email',
      'name',
    ]);
    expect(facts.mutationInputs['auth/sign-in']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'email', required: true }),
        expect.objectContaining({ name: 'next', required: false }),
        expect.objectContaining({ name: 'password', required: true }),
      ]),
    );

    const compiled = compileComponentModule({
      fileName: 'components/forms.tsx',
      registryFacts: facts,
      source: stockFormsSource,
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === 'KV242')).toEqual([]);
    expect(compiled.componentGraphFacts.flatMap((component) => component.mutationForms)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mutation: 'mutations/add-contact' }),
        expect.objectContaining({ mutation: 'auth/sign-in' }),
        expect.objectContaining({ mutation: 'auth/sign-out' }),
      ]),
    );
  });

  it.each([
    {
      label: 'renamed import alias stays closed',
      replacements: {
        'components/forms.tsx': `import { addContact as save } from '../mutations.js';\n<form mutation={save} />;`,
      },
    },
    {
      label: 'namespace import stays closed',
      replacements: {
        'components/forms.tsx': `import * as mutations from '../mutations.js';\n<form mutation={mutations.addContact} />;`,
      },
    },
    {
      label: 'computed generated projection stays closed',
      replacements: {
        'auth.ts': `
import { createAppAuthBindings } from './_kovo/app-runtime-db.js';
const authBindings = createAppAuthBindings({});
export const appSignIn = authBindings['signIn'];
export const appSignOut = authBindings.signOut;
`,
      },
    },
    {
      label: 'structural mutation lookalike stays closed',
      replacements: {
        'mutations.ts': `
function mutation(value) { return { key: 'admin/delete', ...value }; }
export const addContact = mutation({ input: {} });
`,
      },
    },
    {
      label: 'renamed re-export alias stays closed',
      replacements: {
        'components/forms.tsx': `import { save } from '../mutations-barrel.js';\n<form mutation={save} />;`,
        'mutations-barrel.ts': `export { addContact as save } from './mutations.js';`,
      },
    },
    {
      label: 'missing relative target stays closed',
      replacements: {
        'components/forms.tsx': `import { missing } from '../missing.js';\n<form mutation={missing} />;`,
      },
    },
    {
      label: 'cyclic named re-export stays closed',
      replacements: {
        'components/forms.tsx': `import { addContact } from '../mutations-barrel.js';\n<form mutation={addContact} />;`,
        'mutations-barrel.ts': `export { addContact } from './other-barrel.js';`,
        'other-barrel.ts': `export { addContact } from './mutations-barrel.js';`,
      },
    },
    {
      label: 'mutated generated binding carrier stays closed',
      replacements: {
        'auth.ts': `
import { createAppAuthBindings } from './_kovo/app-runtime-db.js';
const authBindings = createAppAuthBindings({});
Object.defineProperty(authBindings, 'signIn', { value: {} });
export const appSignIn = authBindings.signIn;
export const appSignOut = authBindings.signOut;
`,
      },
    },
    {
      label: 'aliased generated binding carrier stays closed',
      replacements: {
        'auth.ts': `
import { createAppAuthBindings } from './_kovo/app-runtime-db.js';
const authBindings = createAppAuthBindings({});
const alias = authBindings;
export const appSignIn = alias.signIn;
export const appSignOut = authBindings.signOut;
`,
      },
    },
    {
      label: 'wrapper around generated constructor stays closed',
      replacements: {
        '_kovo/app-runtime-db.ts': `
import { createBetterAuthPostgresBindingsFromEnvironment } from '@kovojs/better-auth';
function wrap(value) { return value; }
export function createAppAuthBindings(options) {
  return wrap(createBetterAuthPostgresBindingsFromEnvironment(options));
}
`,
      },
    },
  ])('$label', ({ replacements }) => {
    expect(bindingNames(stockFiles(replacements))).not.toEqual([
      'addContact',
      'appSignIn',
      'appSignOut',
    ]);
  });

  it('closes every binding when distinct terminal definitions claim one key', () => {
    const files = stockFiles({
      'components/forms.tsx': `
import { first } from '../first.js';
import { second } from '../second.js';
<form mutation={first} />;
<form mutation={second} />;
`,
      'first.ts': `import { mutation } from '@kovojs/server'; export const first = mutation('shared/key', {});`,
      'second.ts': `import { mutation } from '@kovojs/server'; export const second = mutation('shared/key', {});`,
    });
    expect(bindingNames(files)).toEqual([]);
  });

  it('keeps a structural registry fact path-scoped to its exact component file', () => {
    const facts = projectMutationRegistryFactsFromFiles(stockFiles());
    const forged = compileComponentModule({
      fileName: 'components/forged.tsx',
      registryFacts: facts,
      source: `
const addContact = { key: 'mutations/add-contact' };
export const Forged = component({ render: () => <form mutation={addContact} /> });
`,
    });
    expect(forged.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KV242' })]),
    );
  });
});
