import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions, diagnosticDefinitionText } from './diagnostics.js';

describe('diagnostic registry', () => {
  it('contains the Phase 0 diagnostic registry from SPEC §11.3', () => {
    expect(Object.keys(diagnosticDefinitions)).toEqual([
      'FW201',
      'FW210',
      'FW211',
      'FW212',
      'FW220',
      'FW221',
      'FW222',
      'FW223',
      'FW224',
      'FW225',
      'FW226',
      'FW227',
      'FW228',
      'FW230',
      'FW231',
      'FW232',
      'FW233',
      'FW234',
      'FW235',
      'FW301',
      'FW302',
      'FW303',
      'FW304',
      'FW310',
      'FW311',
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
      'FW411',
    ]);
  });

  it('keeps all messages snapshot-visible for diagnostic golden tests', () => {
    expect(diagnosticDefinitions).toMatchInlineSnapshot(`
      {
        "FW201": {
          "code": "FW201",
          "detailLabels": {
            "blockedExpression": "Blocked expression:",
            "elementParams": "Element params:",
            "handlerLowering": "Would lower to:",
          },
          "help": "Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.
      Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.",
          "message": "Closure captures unserializable value.",
          "severity": "error",
        },
        "FW210": {
          "code": "FW210",
          "message": "Anonymous handler; name it for stable identity.",
          "severity": "lint",
        },
        "FW211": {
          "code": "FW211",
          "message": "on:load eager trigger requires a justification comment.",
          "severity": "lint",
        },
        "FW212": {
          "code": "FW212",
          "message": "Unknown on:* event or execution trigger name.",
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
        "FW222": {
          "code": "FW222",
          "message": "Hand-written binding stamp disagrees with the typed expression it wraps.",
          "severity": "error",
        },
        "FW223": {
          "code": "FW223",
          "message": "Redundant hand-written binding stamp in sugar; the compiler derives it.",
          "severity": "lint",
        },
        "FW224": {
          "code": "FW224",
          "message": "Static id appears in a repeatable component or duplicate page composition.",
          "severity": "error",
        },
        "FW225": {
          "code": "FW225",
          "message": "JSX nesting violates the HTML content model.",
          "severity": "error",
        },
        "FW226": {
          "code": "FW226",
          "message": "fw-deps or fw-c names an unknown query instance or component.",
          "severity": "error",
        },
        "FW227": {
          "code": "FW227",
          "help": "Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.
      SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.",
          "message": "Binding path traverses a nullable segment without ?.",
          "severity": "error",
        },
        "FW228": {
          "code": "FW228",
          "help": "SPEC §9.5 requires static-first route matching to be unambiguous at compile time; split the patterns or make one route path more specific.",
          "message": "Ambiguous route table: two routes can match the same canonical request path.",
          "severity": "error",
        },
        "FW230": {
          "code": "FW230",
          "detailLabels": {
            "blockedChildren": "Blocked children:",
            "slotHoist": "Would hoist children to:",
          },
          "help": "Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.",
          "message": "Fragment-target children cannot lower to a component reference.",
          "severity": "error",
        },
        "FW231": {
          "code": "FW231",
          "message": "Unmergeable attribute conflict in primitive composition.",
          "severity": "error",
        },
        "FW232": {
          "code": "FW232",
          "message": "Author overrides a primitive-owned ARIA or state attribute.",
          "severity": "lint",
        },
        "FW233": {
          "code": "FW233",
          "message": "Two writers target the same binding slot.",
          "severity": "error",
        },
        "FW234": {
          "code": "FW234",
          "help": "SPEC §6.1.1 requires lowercase, dash-terminated, app-wide unique package component prefixes; jiso-* is reserved for @jiso/* packages.",
          "message": "Package component prefix registration conflict or reservation violation.",
          "severity": "error",
        },
        "FW235": {
          "code": "FW235",
          "help": "SPEC §5.2: TSX is the sole app-authoring surface. Write JSX with typed expressions and let the compiler emit renderSource(), fw-c, fw-deps, and data-bind.",
          "message": "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.",
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
        "FW304": {
          "code": "FW304",
          "message": "Reserved query name is not allowed.",
          "severity": "error",
        },
        "FW310": {
          "code": "FW310",
          "message": "Invalidated query lacks optimistic transform.",
          "severity": "warn",
        },
        "FW311": {
          "code": "FW311",
          "message": "Query/state-dependent DOM position has no update status.",
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
          "help": "No mutation touch graph writes that domain.",
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
          "help": "Opaque query projection requires a declared output schema.",
          "message": "Query result shape failed declared output schema.",
          "severity": "error",
        },
        "FW411": {
          "code": "FW411",
          "message": "Query read set includes an exempt table.",
          "severity": "error",
        },
      }
    `);
  });

  it('renders registry messages with optional help text for diagnostic consumers', () => {
    expect(diagnosticDefinitionText('FW407', { includeHelp: true })).toBe(
      'Query read from undeclared domain. No mutation touch graph writes that domain.',
    );
    expect(diagnosticDefinitionText('FW410', { preferHelp: true })).toBe(
      'Opaque query projection requires a declared output schema.',
    );
  });
});
