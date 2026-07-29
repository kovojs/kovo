import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createFrameworkManagedDbProvider } from './guards.js';
import { kovoDevDatabasePosture } from './internal/vite-security-profile.js';

describe('kovo dev database posture', () => {
  it('reports only the active closed-app provider rather than installed packages', () => {
    expect(kovoDevDatabasePosture(createApp())).toBe('none configured');
    expect(kovoDevDatabasePosture(createApp({ db: () => ({}) }))).toBe(
      'application-defined (active driver not introspectable)',
    );

    const postures = [
      ['postgres-pglite', 'Postgres (PGlite embedded development driver)'],
      ['postgres-external', 'Postgres (external node-postgres driver)'],
      ['sqlite', 'SQLite (experimental single-principal driver)'],
    ] as const;
    for (const [developmentPosture, label] of postures) {
      const db = createFrameworkManagedDbProvider(() => ({}), { developmentPosture });
      expect(kovoDevDatabasePosture(createApp({ db }))).toBe(label);
    }
  });
});
