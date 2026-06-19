import { describe, expect, it } from 'vitest';

import * as generated from './generated.js';
import { applyDeferredStreamResponseToRuntime } from './apply-deferred-stream.js';
import { derive } from './derive.js';
import { handler } from './handlers.js';
import { installKovoLoader } from './loader.js';
import { applyCompiledQueryUpdatePlan } from './query-bindings.js';
import { createQueryStore } from './query-store.js';
import { kovoEscapeHtml, kovoStyleProperty } from './security-output.js';

describe('runtime generated exports', () => {
  it('exports the compiler-emitted runtime ABI from the generated subpath', () => {
    // SPEC.md §5.2: emitted modules are compiler-owned artifacts, so their
    // runtime ABI is isolated from app-authored source imports.
    expect(generated.applyDeferredStreamResponseToRuntime).toBe(
      applyDeferredStreamResponseToRuntime,
    );
    expect(generated.applyCompiledQueryUpdatePlan).toBe(applyCompiledQueryUpdatePlan);
    expect(generated.createQueryStore).toBe(createQueryStore);
    expect(generated.derive).toBe(derive);
    expect(generated.handler).toBe(handler);
    expect(generated.installKovoLoader).toBe(installKovoLoader);
    expect(generated.kovoEscapeHtml).toBe(kovoEscapeHtml);
    expect(generated.kovoStyleProperty).toBe(kovoStyleProperty);
  });
});
