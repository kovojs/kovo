import { extractTouchGraphFromProject } from '../../../packages/drizzle/src/static.js';
import { describe, expect, it } from 'vitest';

import { crossPackageOracleFixture } from '../../../packages/conformance-fixtures/src/oracle-fixtures.js';
import { extractQueryFactsFromProject } from './test-helpers.js';

describe('Drizzle pinned subset conformance', () => {
  it('pins the shared cross-package oracle query and touch facts under real Drizzle extraction', () => {
    const fixture = crossPackageOracleFixture();
    const facts = extractQueryFactsFromProject({ files: fixture.drizzleProject.files });

    expect(facts).toMatchObject(fixture.graph.queryFacts);
    expect(facts[0]).toMatchObject({
      hasClientArgPredicate: true,
      instanceKey: {
        domain: 'cart',
        key: 'arg:cartId',
      },
    });
    expect(extractTouchGraphFromProject({ files: fixture.drizzleProject.files })).toEqual(
      fixture.graph.touchGraph,
    );
  });
});
