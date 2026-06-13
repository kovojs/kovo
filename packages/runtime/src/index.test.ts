import { describe, expect, it, vi } from 'vitest';

import { installJisoLoader } from './index.js';
import { FakeRoot } from './runtime-test-fakes.js';

describe('runtime barrel loader smoke', () => {
  it('registers delegated capture listeners without importing handler modules', () => {
    // SPEC.md §4.4: the public runtime barrel exposes the always-loaded loader path.
    const root = new FakeRoot();
    const importModule = vi.fn();

    const loader = installJisoLoader({ importModule, root });

    expect(loader.events).toEqual(['click', 'submit', 'input', 'change']);
    expect([...root.listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
    expect(importModule).not.toHaveBeenCalled();
  });
});
