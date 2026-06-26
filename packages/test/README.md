# @kovojs/test

Test harness utilities for Kovo apps: PGlite and SQLite database setup, mutation
helpers, HTML fragment assertions, and verifier checks against the touch graph.

```sh
pnpm add -D @kovojs/test
```

```ts
import { createKovoTestHarness } from '@kovojs/test/harness';

const harness = createKovoTestHarness({
  db: { contacts: [] },
  pages: {
    '/': () => '<main>Contacts</main>',
  },
});

const page = await harness.page('/');
expect(page.text()).toContain('Contacts');
```

## Reference

- API: `/api/test/`
- Guide: `/guides/testing/`
