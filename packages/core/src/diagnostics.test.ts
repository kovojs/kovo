import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from './diagnostics.js';

describe('diagnostic registry', () => {
  it('contains the Phase 0 diagnostic registry from SPEC §11.3', () => {
    expect(Object.keys(diagnosticDefinitions)).toEqual([
      'FW201',
      'FW210',
      'FW220',
      'FW221',
      'FW301',
      'FW302',
      'FW303',
      'FW310',
      'FW320',
      'FW330',
      'FW402',
      'FW403',
      'FW404',
      'FW405',
      'FW406',
      'FW407',
      'FW408',
      'FW409',
      'FW410',
    ]);
  });

  it('keeps all messages snapshot-visible for diagnostic golden tests', () => {
    expect(diagnosticDefinitions).toMatchInlineSnapshot(`
      {
        "FW201": {
          "code": "FW201",
          "message": "Closure captures unserializable value.",
          "severity": "error",
        },
        "FW210": {
          "code": "FW210",
          "message": "Anonymous handler; name it for stable identity.",
          "severity": "lint",
        },
        "FW220": {
          "code": "FW220",
          "message": "Literal href or form action matches no declared route.",
          "severity": "error",
        },
        "FW221": {
          "code": "FW221",
          "message": "IDREF references an id not present in component scope.",
          "severity": "error",
        },
        "FW301": {
          "code": "FW301",
          "message": "Server fact stored in island-local state.",
          "severity": "lint",
        },
        "FW302": {
          "code": "FW302",
          "message": "data-bind path is not present in the declared query shape.",
          "severity": "error",
        },
        "FW303": {
          "code": "FW303",
          "message": "Fragment target render input is not declared as query data or stamped props.",
          "severity": "error",
        },
        "FW310": {
          "code": "FW310",
          "message": "Invalidated query lacks optimistic transform.",
          "severity": "warn",
        },
        "FW320": {
          "code": "FW320",
          "message": "Event payload overlaps query data; use a transform.",
          "severity": "lint",
        },
        "FW330": {
          "code": "FW330",
          "message": "Direct db access in a mutation handler; route through domain.",
          "severity": "lint",
        },
        "FW402": {
          "code": "FW402",
          "message": "Write touched an undeclared domain.",
          "severity": "error",
        },
        "FW403": {
          "code": "FW403",
          "message": "Declared domain was never observed written.",
          "severity": "warn",
        },
        "FW404": {
          "code": "FW404",
          "message": "Write to unmapped table.",
          "severity": "error",
        },
        "FW405": {
          "code": "FW405",
          "message": "Conditional write branch was never executed under instrumentation.",
          "severity": "warn",
        },
        "FW406": {
          "code": "FW406",
          "message": "Statically un-analyzable write site; manual touches required.",
          "severity": "warn",
        },
        "FW407": {
          "code": "FW407",
          "message": "Query read from undeclared domain.",
          "severity": "error",
        },
        "FW408": {
          "code": "FW408",
          "message": "Declared row key differs from observed row predicate.",
          "severity": "error",
        },
        "FW409": {
          "code": "FW409",
          "message": "Non-eq predicate degraded to table-level invalidation.",
          "severity": "notice",
        },
        "FW410": {
          "code": "FW410",
          "message": "Query result shape failed declared output schema.",
          "severity": "error",
        },
      }
    `);
  });
});
