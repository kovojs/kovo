import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  runKovoCommand,
  type KovoCommandExitCode,
  type KovoSemanticCommandRequest,
} from './api.js';
import * as PublicCli from './api.js';

describe('@kovojs/cli public API', () => {
  it('publishes the semantic command facade without exposing the argv dispatcher', () => {
    expect(Object.keys(PublicCli).sort()).toEqual(['kovoCheck', 'kovoExplain', 'runKovoCommand']);
    expect('main' in PublicCli).toBe(false);
    expect('mainAsync' in PublicCli).toBe(false);

    const request: KovoSemanticCommandRequest = {
      arguments: { appModule: 'src/app.tsx' },
      command: 'build',
      form: 'build',
      options: { cache: false, check: true, out: 'dist', preset: 'node' },
    };
    expectTypeOf(runKovoCommand).parameter(0).toEqualTypeOf<KovoSemanticCommandRequest>();
    expectTypeOf(runKovoCommand).returns.toEqualTypeOf<Promise<KovoCommandExitCode>>();
    expect(request.command).toBe('build');

    const exportWithAssetPair: KovoSemanticCommandRequest = {
      arguments: { appModule: 'src/app.tsx' },
      command: 'export',
      form: 'export',
      options: { dist: 'dist', manifest: 'dist/.vite/manifest.json' },
    };
    expect(exportWithAssetPair.command).toBe('export');

    // The semantic type preserves the argv grammar: either both asset-copy inputs
    // are supplied or neither is. A single field never reaches runtime parsing.
    // @ts-expect-error -- `--manifest` and `--dist` are one paired option group.
    const exportWithPartialAssetPair: KovoSemanticCommandRequest = {
      arguments: { appModule: 'src/app.tsx' },
      command: 'export',
      form: 'export',
      options: { manifest: 'dist/.vite/manifest.json' },
    };
    expect(exportWithPartialAssetPair.command).toBe('export');

    // @ts-expect-error -- required repeatable arguments are non-empty tuples.
    const addWithoutComponents: KovoSemanticCommandRequest = {
      arguments: { components: [] },
      command: 'add',
      form: 'components',
    };
    expect(addWithoutComponents.command).toBe('add');

    // @ts-expect-error -- a required selector represents the flag's exact true value.
    const disabledRequiredSelector: KovoSemanticCommandRequest = {
      arguments: {},
      command: 'explain',
      form: 'sources-sinks',
      options: { sourcesSinks: false },
    };
    expect(disabledRequiredSelector.command).toBe('explain');

    // @ts-expect-error -- no-argument forms reject surplus semantic fields.
    const updateDocsWithSurplusArgument: KovoSemanticCommandRequest = {
      arguments: { transport: 'filesystem' },
      command: 'update-docs',
      form: 'update-docs',
    };
    expect(updateDocsWithSurplusArgument.command).toBe('update-docs');

    // @ts-expect-error -- an exact empty semantic record is still an object.
    const updateDocsWithPrimitiveArguments: KovoSemanticCommandRequest = {
      arguments: 'not-an-object',
      command: 'update-docs',
      form: 'update-docs',
    };
    expect(updateDocsWithPrimitiveArguments.command).toBe('update-docs');

    const mutationWithOptimisticDetail: KovoSemanticCommandRequest = {
      arguments: { kind: 'mutation', target: 'updateCart' },
      command: 'explain',
      form: 'target',
      options: { layouts: false, optimistic: true },
    };
    expect(mutationWithOptimisticDetail.arguments.kind).toBe('mutation');

    const pageWithLayoutDetail: KovoSemanticCommandRequest = {
      arguments: { kind: 'page', target: '/' },
      command: 'explain',
      form: 'target',
      options: { layouts: true, optimistic: false },
    };
    expect(pageWithLayoutDetail.arguments.kind).toBe('page');

    // @ts-expect-error -- optimistic detail is meaningful only for mutations.
    const pageWithOptimisticDetail: KovoSemanticCommandRequest = {
      arguments: { kind: 'page', target: '/' },
      command: 'explain',
      form: 'target',
      options: { optimistic: true },
    };
    expect(pageWithOptimisticDetail.arguments.kind).toBe('page');

    // @ts-expect-error -- layout detail is meaningful only for pages.
    const queryWithLayoutDetail: KovoSemanticCommandRequest = {
      arguments: { kind: 'query', target: 'cart' },
      command: 'explain',
      form: 'target',
      options: { layouts: true },
    };
    expect(queryWithLayoutDetail.arguments.kind).toBe('query');

    // @ts-expect-error -- long-lived commands are not accepted by the one-shot facade.
    const devRequest: KovoSemanticCommandRequest = {
      arguments: { appModule: 'src/app.tsx' },
      command: 'dev',
      form: 'dev',
    };
    expect(devRequest.command).toBe('dev');
  });

  it('rejects long-lived JavaScript requests before dispatch', async () => {
    await expect(
      runKovoCommand({
        arguments: {},
        command: 'mcp',
        form: 'mcp',
      } as never),
    ).rejects.toThrow('long-lived');
  });
});
