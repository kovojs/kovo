# @kovojs/cli

The `kovo` command and its curated programmatic API. Use it to run one-shot
semantic commands without spelling argv, explain an app graph, run framework
audits, update agent docs, add copy-in UI, and export static output.

```sh
pnpm add -D @kovojs/cli
pnpm exec kovo explain graph.json
```

```ts
import { kovoCheck, kovoExplain } from '@kovojs/cli';
import { readFile } from 'node:fs/promises';

const graph = JSON.parse(await readFile('graph.json', 'utf8'));

const explain = kovoExplain(graph, { kind: 'page', target: '/' });
const check = kovoCheck(graph);
```

```ts
import { runKovoCommand } from '@kovojs/cli';

const exitCode = await runKovoCommand({
  arguments: { appModule: './src/app.tsx' },
  command: 'build',
  form: 'build',
  options: { check: true, out: 'dist', preset: 'node' },
});
```

## Reference

- API: `/api/cli/`
- Guides: `/guides/cli/`, `/guides/kovo-explain/`
