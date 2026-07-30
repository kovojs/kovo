import {
  collectStaticBuildTrustFactsFromProject,
  type CompilerOwnedAppContractStaticFact,
} from '@kovojs/drizzle/internal/static';
import { describe, expect, it } from 'vitest';

import {
  snapshotBuildOmittedTaskBCapabilityRootForTests,
  snapshotBuildPreEvaluationTrustForTests,
} from './build-export.js';

describe('build durable-task authenticated source snapshot', () => {
  it('keeps imported app.task and scheduling mutation grants exact through assembly', async () => {
    const result = await snapshotBuildPreEvaluationTrustForTests(
      'app.ts',
      durableTaskSourceFiles(),
    );

    expect(result.files).toEqual(['app.ts', 'durable-task.ts', 'kovo.ts', 'schedule.ts']);
    expect(result.unregisteredSinks).toEqual([]);
  });

  it('keeps a structural fake app closed', async () => {
    await expect(
      snapshotBuildPreEvaluationTrustForTests(
        'app.ts',
        durableTaskSourceFiles({
          kovoSource: `
            import { defineKovo } from '@kovojs/server';
            const exactApp = defineKovo({
              appId: '00000000-0000-4000-8000-000000000001',
            });
            export const app = {
              assemble: exactApp.assemble,
              mutation: exactApp.mutation,
              publicAccess: exactApp.publicAccess,
              task: exactApp.task,
            };
          `,
        }),
      ),
    ).rejects.toThrow(/KV424/u);
  });

  it('closes an omitted exact TASK B root carrier independently of runtime assembly', async () => {
    const sinks = await snapshotBuildOmittedTaskBCapabilityRootForTests(
      'app.ts',
      durableTaskSourceFiles(),
    );

    expect(sinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: expect.stringContaining('sink=capability-closure'),
        }),
      ]),
    );
  });

  it('rejects a stale compiler-owned app-contract source carrier before classification', () => {
    const fileName = 'stale.ts';
    const source = `
      declare const app: { task(definition: unknown): unknown };
      export const durableTask = app.task({ run() {} });
    `;
    const start = source.indexOf('app.task');
    const staleFact: CompilerOwnedAppContractStaticFact = {
      end: start + 'app.task'.length,
      fileName,
      memberName: 'task',
      ownerKey: 'd1v7:durable-task-source-snapshot',
      source: `${source}\n// stale`,
      start,
    };

    expect(() =>
      collectStaticBuildTrustFactsFromProject({
        appContractStaticFacts: [staleFact],
        files: [{ fileName, source }],
      }),
    ).toThrow(/stale source snapshot/u);
  });
});

function durableTaskSourceFiles(
  options: {
    readonly appSource?: string;
    readonly kovoSource?: string;
  } = {},
): readonly { readonly fileName: string; readonly source: string }[] {
  return [
    {
      fileName: 'kovo.ts',
      source:
        options.kovoSource ??
        `
          import { defineKovo } from '@kovojs/server';
          export const app = defineKovo({
            appId: '00000000-0000-4000-8000-000000000001',
          });
        `,
    },
    {
      fileName: 'durable-task.ts',
      source: `
        import { s } from '@kovojs/server';
        import { app } from './kovo.js';

        const publicTask = app.publicAccess('durable task source-snapshot regression');
        export const recordEffect = app.mutation({
          access: publicTask,
          input: s.object({ id: s.string() }),
          handler(input) {
            return { id: input.id };
          },
        });
        export const durableTask = app.task({
          input: s.object({ generation: s.number(), id: s.string() }),
          maxGenerations: 1,
          async run(input, context) {
            await context.actAs('durable-task-owner').runMutation(recordEffect, {
              id: input.id,
            });
            await context.schedule(durableTask, {
              generation: input.generation + 1,
              id: input.id,
            });
          },
        });
      `,
    },
    {
      fileName: 'schedule.ts',
      source: `
        import { s } from '@kovojs/server';
        import { durableTask } from './durable-task.js';
        import { app } from './kovo.js';

        const publicSchedule = app.publicAccess('durable schedule source-snapshot regression');
        export const scheduleTask = app.mutation({
          access: publicSchedule,
          input: s.object({ id: s.string() }),
          async handler(input, request) {
            const handle = await request.schedule(durableTask, {
              generation: 0,
              id: input.id,
            });
            return { cancelled: await request.cancel(handle) };
          },
        });
      `,
    },
    {
      fileName: 'app.ts',
      source:
        options.appSource ??
        `
          import { durableTask, recordEffect } from './durable-task.js';
          import { app } from './kovo.js';
          import { scheduleTask } from './schedule.js';

          export default app.assemble({
            mutations: [recordEffect, scheduleTask],
            tasks: [durableTask],
          });
        `,
    },
  ];
}
