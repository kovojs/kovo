import { describe, expect, it } from 'vitest';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import {
  hasStaticHandlerWriteSinkDiagnostic,
  resolvedHandlerWriteSinkMessage,
} from './graph-explain-format.js';

describe('CLI graph security diagnostic authority', () => {
  it('keeps KV330 handler-write findings visible after late Set.has poisoning', () => {
    const originalHas = Set.prototype.has;
    let observed = false;

    try {
      Set.prototype.has = () => false;
      observed = hasStaticHandlerWriteSinkDiagnostic([
        {
          code: 'KV330',
          message: resolvedHandlerWriteSinkMessage('task'),
          severity: 'error',
          site: 'src/tasks/admin.ts:12',
        } as CoreGraph.StaticDiagnosticFact,
      ]);
    } finally {
      Set.prototype.has = originalHas;
    }

    expect(observed).toBe(true);
  });
});
