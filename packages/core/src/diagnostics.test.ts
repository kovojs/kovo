import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions, diagnosticDefinitionText } from './diagnostics.js';

describe('diagnostic registry', () => {
  it('contains the Phase 0 diagnostic registry from SPEC §11.3', () => {
    expect(Object.keys(diagnosticDefinitions)).toEqual([
      'KV201',
      'KV210',
      'KV211',
      'KV212',
      'KV220',
      'KV221',
      'KV222',
      'KV223',
      'KV224',
      'KV225',
      'KV226',
      'KV227',
      'KV228',
      'KV230',
      'KV231',
      'KV232',
      'KV233',
      'KV234',
      'KV235',
      'KV301',
      'KV302',
      'KV303',
      'KV304',
      'KV310',
      'KV311',
      'KV320',
      'KV330',
      'KV402',
      'KV403',
      'KV404',
      'KV405',
      'KV406',
      'KV407',
      'KV408',
      'KV409',
      'KV410',
      'KV411',
    ]);
  });

  it('keeps all messages snapshot-visible for diagnostic golden tests', () => {
    expect(diagnosticDefinitions).toMatchInlineSnapshot(`
      {
        "KV201": {
          "code": "KV201",
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
        "KV210": {
          "code": "KV210",
          "message": "Anonymous handler; name it for stable identity.",
          "severity": "lint",
        },
        "KV211": {
          "code": "KV211",
          "message": "on:load eager trigger requires a justification comment.",
          "severity": "lint",
        },
        "KV212": {
          "code": "KV212",
          "message": "Unknown on:* event or execution trigger name.",
          "severity": "lint",
        },
        "KV220": {
          "code": "KV220",
          "message": "Literal href or form action matches no declared route.",
          "severity": "error",
        },
        "KV221": {
          "code": "KV221",
          "message": "IDREF references an id not present in component scope.",
          "severity": "error",
        },
        "KV222": {
          "code": "KV222",
          "message": "Hand-written binding stamp disagrees with the typed expression it wraps.",
          "severity": "error",
        },
        "KV223": {
          "code": "KV223",
          "message": "Redundant hand-written binding stamp in sugar; the compiler derives it.",
          "severity": "lint",
        },
        "KV224": {
          "code": "KV224",
          "message": "Static id is duplicated in component scope or appears inside a repeatable stamp.",
          "severity": "error",
        },
        "KV225": {
          "code": "KV225",
          "message": "JSX nesting violates the HTML content model.",
          "severity": "error",
        },
        "KV226": {
          "code": "KV226",
          "message": "kovo-deps or kovo-c names an unknown query instance or component.",
          "severity": "error",
        },
        "KV227": {
          "code": "KV227",
          "help": "Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.
      SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.",
          "message": "Binding path traverses a nullable segment without ?.",
          "severity": "error",
        },
        "KV228": {
          "code": "KV228",
          "help": "SPEC §9.5 requires static-first route matching to be unambiguous at compile time; split the patterns or make one route path more specific.",
          "message": "Ambiguous route table: two routes can match the same canonical request path.",
          "severity": "error",
        },
        "KV230": {
          "code": "KV230",
          "detailLabels": {
            "blockedChildren": "Blocked children:",
            "slotHoist": "Would hoist children to:",
          },
          "help": "Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.",
          "message": "Fragment-target children cannot lower to a component reference.",
          "severity": "error",
        },
        "KV231": {
          "code": "KV231",
          "message": "Unmergeable attribute conflict in primitive composition.",
          "severity": "error",
        },
        "KV232": {
          "code": "KV232",
          "message": "Author overrides a primitive-owned ARIA or state attribute.",
          "severity": "lint",
        },
        "KV233": {
          "code": "KV233",
          "message": "Two writers target the same binding slot.",
          "severity": "error",
        },
        "KV234": {
          "code": "KV234",
          "help": "SPEC §6.1.1 requires lowercase, dash-terminated, app-wide unique package component prefixes; kovo-* is reserved for @kovojs/* packages.",
          "message": "Package component prefix registration conflict or reservation violation.",
          "severity": "error",
        },
        "KV235": {
          "code": "KV235",
          "help": "SPEC §5.2: TSX is the sole app-authoring surface. Write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.",
          "message": "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.",
          "severity": "error",
        },
        "KV301": {
          "code": "KV301",
          "message": "Server fact stored in island-local state.",
          "severity": "lint",
        },
        "KV302": {
          "code": "KV302",
          "message": "data-bind path is not present in the declared query shape.",
          "severity": "error",
        },
        "KV303": {
          "code": "KV303",
          "message": "Fragment target render input is not declared as query data or stamped props.",
          "severity": "error",
        },
        "KV304": {
          "code": "KV304",
          "message": "Reserved query name is not allowed.",
          "severity": "error",
        },
        "KV310": {
          "code": "KV310",
          "message": "Invalidated query lacks optimistic transform.",
          "severity": "warn",
        },
        "KV311": {
          "code": "KV311",
          "help": "Fixes: add a data-bind/query update plan, mark the expression renderOnce, move the subtree behind a fragment target, or make the component isomorphic.",
          "message": "Query/state-dependent DOM position has no update status.",
          "severity": "warn",
        },
        "KV320": {
          "code": "KV320",
          "message": "Event payload overlaps query data; use a transform.",
          "severity": "lint",
        },
        "KV330": {
          "code": "KV330",
          "message": "Direct db access in a mutation handler; route through domain.",
          "severity": "lint",
        },
        "KV402": {
          "code": "KV402",
          "message": "Write touched an undeclared domain.",
          "severity": "error",
        },
        "KV403": {
          "code": "KV403",
          "message": "Declared domain was never observed written.",
          "severity": "warn",
        },
        "KV404": {
          "code": "KV404",
          "message": "Write to unmapped table.",
          "severity": "error",
        },
        "KV405": {
          "code": "KV405",
          "message": "Conditional write branch was never executed under instrumentation.",
          "severity": "warn",
        },
        "KV406": {
          "code": "KV406",
          "message": "Statically un-analyzable write site; manual touches required.",
          "severity": "warn",
        },
        "KV407": {
          "code": "KV407",
          "help": "No mutation touch graph writes that domain.",
          "message": "Query read from undeclared domain.",
          "severity": "error",
        },
        "KV408": {
          "code": "KV408",
          "message": "Declared row key differs from observed row predicate.",
          "severity": "error",
        },
        "KV409": {
          "code": "KV409",
          "message": "Non-eq predicate degraded to table-level invalidation.",
          "severity": "notice",
        },
        "KV410": {
          "code": "KV410",
          "help": "Opaque query projection requires a declared output schema.",
          "message": "Query result shape failed declared output schema.",
          "severity": "error",
        },
        "KV411": {
          "code": "KV411",
          "message": "Query read set includes an exempt table.",
          "severity": "error",
        },
      }
    `);
  });

  it('renders registry messages with optional help text for diagnostic consumers', () => {
    expect(diagnosticDefinitionText('KV407', { includeHelp: true })).toBe(
      'Query read from undeclared domain. No mutation touch graph writes that domain.',
    );
    expect(diagnosticDefinitionText('KV410', { preferHelp: true })).toBe(
      'Opaque query projection requires a declared output schema.',
    );
  });
});
