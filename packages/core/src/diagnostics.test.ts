import { describe, expect, it } from 'vitest';

import {
  compilerDiagnosticTeachingSchemas,
  diagnosticDefinitions,
  diagnosticDefinitionText,
  isDiagnosticCode,
} from './diagnostics.js';

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
      'KV236',
      'KV237',
      'KV238',
      'KV239',
      'KV240',
      'KV241',
      'KV242',
      'KV243',
      'KV244',
      'KV301',
      'KV302',
      'KV303',
      'KV304',
      'KV310',
      'KV311',
      'KV312',
      'KV314',
      'KV315',
      'KV316',
      'KV317',
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
      'KV412',
      'KV413',
      'KV414',
      'KV415',
      'KV416',
      'KV417',
      'KV418',
      'KV419',
      'KV420',
      'KV421',
      'KV422',
      'KV423',
      'KV424',
      'KV425',
      'KV426',
      'KV427',
      'KV428',
      'KV429',
      'KV430',
      'KV431',
      'KV432',
      'KV433',
      'KV434',
      'KV435',
      'KV436',
      'KV437',
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
      Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.
      Blocked reason: captured runtime values cannot be serialized into the generated handler module boundary.
      SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.",
          "message": "Closure captures unserializable value.",
          "severity": "error",
        },
        "KV210": {
          "code": "KV210",
          "help": "Would lower to: a generated Component$element_event handler export with a stable source-derived URL.
      Blocked reason: anonymous handler identity is less stable for generated artifacts, explanations, and agent repairs.
      Fixes: extract a named function in module scope or reference a named local handler from the JSX event.
      SPEC §5.2 requires readable, source-derived emitted names; this lint is advisory and has no suppression beyond accepting the generated fallback name.",
          "message": "Anonymous handler; name it for stable identity.",
          "severity": "lint",
        },
        "KV211": {
          "code": "KV211",
          "help": "Blocked reason: on:load runs at parse time and adds eager JavaScript to the page budget.
      Fixes: use a user/event trigger instead, or attach an adjacent KV211 justification comment when parse-time execution is intentional.
      SPEC §4.7 keeps on:load grep-visible as the eager-JS escape hatch.
      Escape: an attached KV211 justification comment preserves the lint trail without blocking compilation.",
          "message": "on:load eager trigger requires a justification comment.",
          "severity": "lint",
        },
        "KV212": {
          "code": "KV212",
          "help": "Blocked reason: unknown on:* triggers cannot be mapped to the closed event/trigger vocabulary the loader understands.
      Fixes: use a DOM event name, use one of Kovo's declared execution triggers, or move the behavior into a component primitive that owns the attribute.
      SPEC §4.7 requires declared execution so generated artifacts remain auditable.",
          "message": "Unknown on:* event or execution trigger name.",
          "severity": "lint",
        },
        "KV220": {
          "code": "KV220",
          "help": "Would lower to: a route-checked href/action that participates in the typed route registry.
      Blocked reason: the literal target does not match any declared canonical route path.
      Fixes: use a typed route helper, declare the route, correct the literal path, or mark an intentional full-origin/external navigation with the external escape hatch.
      SPEC §6.4 and §9.5 require navigation targets to stay type-checked against the route table.
      Escape: external/full-origin URLs opt out because they are outside the app route graph.",
          "message": "Literal href or form action matches no declared route.",
          "severity": "error",
        },
        "KV221": {
          "code": "KV221",
          "help": "Would lower to: light-DOM IDREF wiring whose target id exists in the same component scope.
      Blocked reason: the referenced id is absent, outside the validated scope, or hidden behind a different component boundary.
      Fixes: add the target id in this component scope, pass a generated id through props, or correct the IDREF attribute value.
      SPEC §4.5 and §6.4 require IDREFs such as commandfor, popovertarget, for, and aria-* to resolve at compile time.",
          "message": "IDREF references an id not present in component scope.",
          "severity": "error",
        },
        "KV222": {
          "code": "KV222",
          "help": "Would lower to: the compiler-derived data-bind stamp for the typed JSX expression.
      Blocked reason: a hand-written stamp names a different path than the expression it wraps, so server render and client update semantics could drift.
      Fixes: remove the hand-written stamp and let the compiler derive it, or make the stamp path exactly match the typed expression.
      SPEC §4.8 treats typed expressions and binding stamps as one fact and rejects drift.",
          "message": "Hand-written binding stamp disagrees with the typed expression it wraps.",
          "severity": "error",
        },
        "KV223": {
          "code": "KV223",
          "help": "Would lower to: the same data-bind stamp the author already wrote by hand.
      Blocked reason: the stamp is redundant in app-authored TSX because the compiler can derive it from the typed expression.
      Fixes: remove the hand-written data-bind stamp and keep the typed JSX expression as the source of truth.
      SPEC §4.8 permits residual stamps for emitted IR fixpoint validation, but app TSX should not hand-author derivable stamps.
      Escape: emitted compiler artifacts may retain residual stamps for fixpoint checks; app source should use TSX sugar.",
          "message": "Redundant hand-written binding stamp in sugar; the compiler derives it.",
          "severity": "lint",
        },
        "KV224": {
          "code": "KV224",
          "help": "Blocked reason: duplicate static ids make IDREF proofs ambiguous, and static ids inside repeatable stamps can produce multiple elements with the same id.
      Fixes: generate ids from props/kovo-key, move the id outside the repeatable subtree, or pass a unique id down to the component.
      SPEC §4.5 requires ids to be unique by construction so KV221 IDREF validation remains meaningful.",
          "message": "Static id is duplicated in component scope or appears inside a repeatable stamp.",
          "severity": "error",
        },
        "KV225": {
          "code": "KV225",
          "help": "Would lower to: HTML whose parsed DOM preserves the authored JSX tree.
      Blocked reason: the HTML parser would re-parent or drop invalid children, changing morph identity and fragment targets after serving.
      Fixes: use content-model-valid wrapper elements, move table rows into table/section parents, or split paragraph/block content into valid siblings.
      SPEC §4.2 requires compiler-served HTML and parsed DOM shape to agree.",
          "message": "JSX nesting violates the HTML content model.",
          "severity": "error",
        },
        "KV226": {
          "code": "KV226",
          "help": "Would lower to: emitted IR stamps whose kovo-c and kovo-deps names resolve to known components and query instances.
      Blocked reason: residual compiler stamps reference a component or query that is not present in the module/registry facts.
      Fixes: recompile from TSX source, correct the generated stamp, or add the missing component/query fact to the compile graph.
      SPEC §5.2 allows lowered IR only as compiler output/fixpoint input, and fixpoint validation must reject stale names.",
          "message": "kovo-deps or kovo-c names an unknown query instance or component.",
          "severity": "error",
        },
        "KV227": {
          "code": "KV227",
          "help": "Blocked reason: the binding path crosses a nullable query segment without declaring empty-on-null behavior.
      Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.
      SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.",
          "message": "Binding path traverses a nullable segment without ?.",
          "severity": "error",
        },
        "KV228": {
          "code": "KV228",
          "help": "Blocked reason: static-first route matching cannot choose a single canonical handler for at least one request path.
      Fixes: remove duplicate route facts, split overlapping patterns, add a static segment, or make one route path more specific.
      SPEC §9.5 requires route matching to be unambiguous at compile time.",
          "message": "Ambiguous route table: two routes can match the same canonical request path or duplicate route path.",
          "severity": "error",
        },
        "KV230": {
          "code": "KV230",
          "detailLabels": {
            "blockedChildren": "Blocked children:",
            "slotHoist": "Would hoist children to:",
          },
          "help": "Blocked reason: fragment responses must fully describe the DOM they produce, but these children cannot be hoisted through serializable props.
      Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.
      SPEC §4.5 requires fragment-target children to lower to component references when they cross the target boundary.",
          "message": "Fragment-target children cannot lower to a component reference.",
          "severity": "error",
        },
        "KV231": {
          "code": "KV231",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "message": "Unmergeable attribute conflict in primitive composition.",
          "severity": "error",
        },
        "KV232": {
          "code": "KV232",
          "help": "Would lower to: author-visible override of a primitive-owned ARIA, role, or state attribute.
      Blocked reason: the override is allowed but can change accessibility semantics or be clobbered by runtime-updated primitive state.
      Fixes: prefer the primitive API, remove the override, or keep it intentionally and audit the generated merge explanation.
      SPEC §4.6 keeps this override as a lint-level escape hatch so author intent stays visible.
      Escape: compilation continues; the lint documents the override for review.",
          "message": "Author overrides a primitive-owned ARIA or state attribute.",
          "severity": "lint",
        },
        "KV233": {
          "code": "KV233",
          "help": "Would lower to: exactly one writer for each data-bind target slot.
      Blocked reason: multiple bindings target the same text/attribute slot, so the client loader cannot choose a single update source.
      Fixes: keep one binding, split values across distinct elements/attributes, or combine the values in a named derive before binding.
      SPEC §4.6 and §4.8 require binding slots to have a single writer.",
          "message": "Two writers target the same binding slot.",
          "severity": "error",
        },
        "KV234": {
          "code": "KV234",
          "help": "Would lower to: package-scoped component names, CSS scopes, and behavior attributes using one effective prefix.
      Blocked reason: the prefix is missing, invalid, duplicated, or reserves kovo-* outside @kovojs/* packages.
      Fixes: assign a lowercase dash-terminated unique prefix, alias one package, or use kovo-* only for framework packages.
      SPEC §6.1.1 requires app-wide unique package component prefixes.",
          "message": "Package component prefix registration conflict or reservation violation.",
          "severity": "error",
        },
        "KV235": {
          "code": "KV235",
          "help": "Blocked reason: app source is hand-authoring lowered string/render IR instead of TSX.
      Fixes: write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.
      SPEC §5.2: TSX is the sole app-authoring surface.
      Escape: there is no v1 suppression or ejection workflow for hand-authored lowered IR.",
          "message": "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.",
          "severity": "error",
        },
        "KV236": {
          "code": "KV236",
          "help": "Blocked reason: the output context can execute script, navigate unexpectedly, inject unsafe CSS, or bypass normal JSX escaping.
      Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.
      SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.",
          "message": "Unsafe output context requires an explicit trusted Kovo escape hatch.",
          "severity": "error",
        },
        "KV237": {
          "code": "KV237",
          "help": "Would lower to: one derived component registry key per component across the app graph.
      Blocked reason: duplicate derived registry keys make component identity, CSS scoping, fragment routing, and graph facts ambiguous.
      Fixes: rename the exported component binding, or move one component so its derived module path namespace differs.
      SPEC §4.2 and §4.8 make derived component names load-bearing for identity, scoped CSS, fragments, and graph facts; duplicate registry keys are ambiguous.",
          "message": "Duplicate component effective wire name.",
          "severity": "error",
        },
        "KV238": {
          "code": "KV238",
          "help": "Would lower to: one derived fragment-target registry key that maps to exactly one component render entry.
      Blocked reason: duplicate fragment-target wire names make enhanced fragment patch routing ambiguous.
      Fixes: rename the exported component binding, add stable authored key identity for repeated instances, move one component so its derived module path namespace differs, or set disableServerRefresh: true on the query-backed component that should not receive enhanced patches.
      SPEC §4.5, §4.8, and §6.2 make fragment-target names derived registry-visible identities; duplicate keys make enhanced fragment patches ambiguous.",
          "message": "Duplicate fragment-target wire name.",
          "severity": "error",
        },
        "KV239": {
          "code": "KV239",
          "help": "Would lower to: static view-transition-name values that uniquely pair old and new DOM elements.
      Blocked reason: duplicate static transition names leave the browser and compiler without one canonical element pair.
      Fixes: give one static viewTransitionName a distinct value, or make the transition name dynamic only when page composition proves uniqueness.
      SPEC §8 uses view-transition-name as a cross-document element-pair identity; duplicate static names in one rendered module or supplied registry facts are ambiguous.",
          "message": "Duplicate static view-transition name.",
          "severity": "error",
        },
        "KV240": {
          "code": "KV240",
          "help": "Would lower to: one query-shape fact per query name for server render, client updates, and binding validation.
      Blocked reason: duplicate query-shape facts would make graph indexing silently choose one shape for all generated bindings.
      Fixes: emit exactly one query-shape fact per query name, or rename one query so generated binding metadata has a single source of truth.
      SPEC §4.8 query binding validation depends on one stable shape per query; duplicate facts would otherwise silently last-write-wins during graph indexing.",
          "message": "Duplicate query-shape fact for one query name.",
          "severity": "error",
        },
        "KV241": {
          "code": "KV241",
          "help": "Blocked reason: derived component registry keys are deploy-load-bearing; changing one can strand in-flight documents whose morph identity still names the prior emitted component.
      Fixes: keep the component binding and module path stable across deploys, or review the rename/move as an intentional identity migration and refresh the previous registry facts.
      SPEC §4.2 and §4.8 make derived component names load-bearing for kovo-c identity, scoped CSS, fragments, and graph facts.",
          "message": "Derived component registry key changed since the previous emitted graph.",
          "severity": "warn",
        },
        "KV242": {
          "code": "KV242",
          "help": "Would lower to: an enhanced mutation form whose successful control names exactly match the bound mutation input schema.
      Blocked reason: form field names are part of the mutation input contract; unknown or missing names would only fail after submit.
      Fixes: rename the control, add the missing required control, or change the mutation input schema so the field set matches the form.
      SPEC §6.2 and §6.3 require form control names to be statically checked against the bound mutation input schema.",
          "message": "Enhanced mutation form fields do not match mutation input schema.",
          "severity": "error",
        },
        "KV243": {
          "code": "KV243",
          "help": "Would lower to: data-stream-text="source:id" on a declared text source element and kovo-text target="source:id" chunks.
      Blocked reason: streaming text targets are framework-owned source IDs, not arbitrary selectors or ambiguous DOM queries.
      Fixes: use streamText="source:id" with a literal namespace and stable id, or remove the streaming text target.
      SPEC §9.1 scopes <kovo-text> to compiler/runtime-declared data-stream-text targets and forbids arbitrary selector targeting.",
          "message": "Invalid stream text target.",
          "severity": "error",
        },
        "KV244": {
          "code": "KV244",
          "help": "Would lower to: <Defer target="..." fallback={...} render={...} /> emitting a framework-owned <kovo-defer> placeholder.
      Blocked reason: defer() is an internal string-composition helper; as a JSX child it bypasses JSX fallback escaping and can render framework markup as text.
      Fixes: import Defer from @kovojs/server and render <Defer ... /> with JSX fallback content, or keep raw HTML behind an explicit trustedHtml(...) boundary outside JSX child position.
      SPEC §8 makes Defer the public route-region deferral API and keeps raw string composition internal.
      Escape: trustedHtml(...) remains the explicit raw-HTML escape hatch, but app JSX children should use <Defer>.",
          "message": "defer() used as a JSX child; use <Defer> instead.",
          "severity": "lint",
        },
        "KV301": {
          "code": "KV301",
          "help": "Blocked reason: server/query facts stored in island-local state create a second client-owned copy of server truth.
      Fixes: keep the value in query data, derive UI-only state from client intent, or store only local presentation state.
      SPEC §4.1 keeps query data server-owned and local state private/client-owned.",
          "message": "Server fact stored in island-local state.",
          "severity": "lint",
        },
        "KV302": {
          "code": "KV302",
          "help": "Would lower to: a data-bind path that the server renderer and loader can both read from the declared query/state shape.
      Blocked reason: the path is absent from the declared shape, so a server render or client update would read undefined.
      Fixes: correct the binding path, update the query projection/schema, or extract a named derive with declared inputs.
      SPEC §4.8 and §6.2 require bindings to type-check against query shapes.",
          "message": "data-bind path is not present in the declared query shape.",
          "severity": "error",
        },
        "KV303": {
          "code": "KV303",
          "help": "Would lower to: a fragment target that can be re-rendered from declared query data plus stamped props.
      Blocked reason: the render input is outside those channels, so a fragment response could not reconstruct the subtree.
      Fixes: declare the value as query data, stamp it as a serializable prop, or move the dependency inside the fragment target.
      SPEC §4.5 requires fragment targets to be reconstructible from declared server inputs.",
          "message": "Fragment target render input is not declared as query data or stamped props.",
          "severity": "error",
        },
        "KV304": {
          "code": "KV304",
          "help": "Blocked reason: the query name collides with a reserved binding root such as state.
      Fixes: rename the query instance to an app-owned root and update its bindings.
      SPEC §4.8 reserves binding roots so query paths and island-local state paths stay unambiguous.",
          "message": "Reserved query name is not allowed.",
          "severity": "error",
        },
        "KV310": {
          "code": "KV310",
          "help": "Would lower to: an optimistic status for each invalidated query edge, such as a transform or await-fragment decision.
      Blocked reason: a mutation invalidates a query without declaring how the UI should predict or defer that update.
      Fixes: add an optimistic transform, declare await-fragment, or narrow the invalidation so the query is not touched.
      SPEC §11.4 requires mutation writes, query invalidations, and optimistic coverage to be checked edge by edge.",
          "message": "Invalidated query lacks optimistic transform.",
          "severity": "warn",
        },
        "KV311": {
          "code": "KV311",
          "help": "Would lower to: a data-bind/update plan, fragment boundary, isomorphic component, or renderOnce marker for the rendered position.
      Blocked reason: the compiler found a query/state-dependent DOM position without an update strategy.
      Fixes: add a data-bind/query update plan, mark the expression renderOnce, move the subtree behind a fragment target, or make the component isomorphic.
      SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.",
          "message": "Query/state-dependent DOM position has no update status.",
          "severity": "warn",
        },
        "KV312": {
          "code": "KV312",
          "help": "Would lower to: an explicit clocks input or query refresh cadence that re-runs the time-dependent rendered position.
      Blocked reason: the position reads wall-clock-sensitive data without a declared cadence, so rendered output can go stale without any modeled write.
      Fixes: declare a component clocks entry, add a query .refresh({ every | at | until }) binding modifier, or mark the clock renderOnce when freezing the value is intentional.
      SPEC §4.8 and §4.9 require every changing rendered fact, including time, to have declared update coverage.
      Escape: renderOnce is the documented suppression for intentionally immutable clock output.",
          "message": "Time-dependent rendered position lacks a declared cadence.",
          "severity": "error",
        },
        "KV314": {
          "code": "KV314",
          "help": "Would lower to: immutable render output that never receives query update plans or fragment refresh.
      Blocked reason: a modeled write invalidates the query read by this renderOnce position, so the immutable declaration would hide stale UI.
      Fixes: remove renderOnce, add a data-bind/query update plan, move the position behind a fragment target, or narrow the write invalidation set.
      SPEC §4.9 requires write -> invalidated query -> rendered position coverage to be checked edge by edge.",
          "message": "renderOnce position reads a query invalidated by a modeled write.",
          "severity": "error",
        },
        "KV315": {
          "code": "KV315",
          "help": "Would lower to: a derive that re-runs from an explicit clocks input such as now.ago.
      Blocked reason: Date.now() and new Date() read the wall clock without a declared cadence, so the update plan can freeze time-derived UI.
      Fixes: declare a component clocks entry and pass now.<name> into the derive, or mark the clock renderOnce when freezing the value is intentional.
      SPEC §4.8 and §4.9 require derive inputs to name every fact that can change rendered output.
      Escape: renderOnce is the documented suppression for intentionally immutable clock output.",
          "message": "Untracked clock read in derive; use a declared clocks input.",
          "severity": "warn",
        },
        "KV316": {
          "code": "KV316",
          "help": "Would lower to: a client self-render that morphs only the island's own positions while leaving each projected-children/named-slot region (kovo-slot="children"/kovo-slot="<name>") in place as a morph-stable hole.
      Blocked reason: a client self-render has no slot/children arguments (projected content ships once in the initial HTML), so an isomorphic island that composes children or slots would re-render those regions as fresh Html and drift from the server output.
      Fixes: lift the dynamic part above or below the slot so the slot region stays a contiguous static hole, make the children a stamped-prop-hoistable inferred fragment target (§4.5/KV230), or drop isomorphic: true and use a server fragment.
      SPEC §4.5 and §4.8 require a children/slot-accepting isomorphic island to partition its render into self-render positions plus preserved projected-children regions.
      Escape: a server fragment (no isomorphic: true) re-renders the whole subtree including projected children with no self-render drift risk.",
          "message": "isomorphic: true on a children/slot-accepting component would drift on self-render.",
          "severity": "error",
        },
        "KV317": {
          "code": "KV317",
          "help": "Would lower to: a static state-bearing ARIA attribute whose author value contradicts the primitive's render-time state.
      Blocked reason: state aria-* (aria-expanded/selected/checked/pressed/current, state-driven aria-disabled) is primitive-wins; the primitive's runtime derive keeps writing it, so a static author value that disagrees with the render-time state is a frozen-vs-clobbered ambiguity the author cannot have meant — distinct from the visible-override lint KV232.
      Fixes: drop the contradicting static value (let the primitive own it) or set it to match the primitive's render-time state.
      SPEC §4.6 makes a contradicting static state aria-* an error (KV317), not the override lint (KV232).",
          "message": "Static state-bearing aria-* value contradicts the primitive's render-time state.",
          "severity": "error",
        },
        "KV320": {
          "code": "KV320",
          "help": "Blocked reason: a fire-and-forget event payload is carrying data that overlaps server-owned query facts.
      Fixes: send only client intent, use an optimistic transform for query data, or route the change through a mutation/domain write.
      SPEC §6.4 keeps cross-island events for intent, not as a shadow transport for server facts.",
          "message": "Event payload overlaps query data; use a transform.",
          "severity": "lint",
        },
        "KV330": {
          "code": "KV330",
          "help": "Blocked reason: direct request/db access in a mutation handler bypasses the domain write surface and weakens touch-graph analysis.
      Fixes: move writes behind a domain() module, inject the domain operation into the handler, or use the typed transaction context only inside the domain layer.
      SPEC §11.4 and §14 require writes to flow through domains so invalidation and verifier diagnostics stay complete.",
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
          "severity": "error",
        },
        "KV406": {
          "code": "KV406",
          "message": "Statically un-analyzable write site; manual touches required.",
          "severity": "error",
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
        "KV412": {
          "code": "KV412",
          "message": "Query reads an unmodeled relation.",
          "severity": "error",
        },
        "KV413": {
          "code": "KV413",
          "help": "Would lower to: an explicit DB-engine fan-out edge that unions trigger-written domains into the mutation touch graph.
      Blocked reason: a detected database trigger can mutate data outside the static Drizzle write chain, so invalidation would miss the affected domain.
      Fixes: declare kovo({ fans: [{ via, domain, when }] }) for the trigger fan-out, move the side-effect into a modeled domain write, or mark the table exempt only when no UI reads it.
      SPEC §10.1 and §11.1 require DB-engine side effects that cannot be derived statically to be declared and checked.",
          "message": "Database engine side-effect needs a declared fan-out.",
          "severity": "error",
        },
        "KV414": {
          "code": "KV414",
          "help": "Would lower to: an owner-scoped read/write whose key predicate is traceable to req.session or an owns() ownership guard.
      Blocked reason: this query or write reaches an owner-annotated table through a client-visible key that is not tied to the session principal, so one user could read or mutate another user's rows (IDOR).
      Fixes: scope the predicate by a session field (e.g. eq(table.id, req.session.userId)), add an owns() ownership guard, or record a public-read justification if the table is genuinely public.
      SPEC §10.1/§10.3/§11.2 make the --unscoped audit a blocking gate: owner-table access must be session-traceable or ownership-guarded.",
          "message": "Owner-table access is not scoped to the session principal (IDOR).",
          "severity": "error",
        },
        "KV415": {
          "code": "KV415",
          "help": "Would lower to: a typed response header record that serializes only framework-allowed header names and cookie values produced by the typed cookie builder.
      Blocked reason: arbitrary header names/values can smuggle forbidden response metadata or split headers when they contain CR/LF/NUL/control characters.
      Fixes: use the typed response-header allowlist, route cookies through the typed cookie builder, or remove the forbidden header write.
      SPEC §9.1.1 keeps response headers in a typed channel so generated wire responses remain auditable.",
          "message": "Response header channel contains a forbidden header name or unsafe header value.",
          "severity": "error",
        },
        "KV416": {
          "code": "KV416",
          "help": "Would lower to: a production delta payload whose render-plan token matches the full dev render contract and whose delta applies back to the same HTML.
      Blocked reason: production delta output or render-plan token monotonicity failed, so a stale tab could patch DOM produced by a different render contract.
      Fixes: include every query shape and the update-plan grammar version in the render-plan token, fix the delta encoder, or disable the production build until the corpus gate passes.
      SPEC §5.2.2 makes this a build-failing production render-equivalence gate.",
          "message": "Prod render-equivalence gate failed.",
          "severity": "error",
        },
        "KV417": {
          "code": "KV417",
          "help": "Would lower to: a deploy-skew policy that retains prior immutable /c/__v/... modules and per-token /_q reads for at least 24 hours.
      Blocked reason: the configured serving layer cannot retain the previous render-plan contract long enough for stale documents to recover safely.
      Fixes: raise the deploy-skew retention window to at least 24 hours, configure immutable client-module retention, and keep prior-token query reads available for the window.
      SPEC §14 requires stale documents to fail loud or recover instead of silently merging cross-build data.",
          "message": "Deploy-skew retention window is below the required floor.",
          "severity": "error",
        },
        "KV418": {
          "code": "KV418",
          "help": "Would lower to: a csrf-exempt endpoint that authenticates by a signature/verifier (e.g. a webhook), not by the session cookie.
      Blocked reason: this endpoint opts out of CSRF protection (csrf: false) yet depends on the session — it reads req.session or runs a session/cookie-derived guard (authed, role(), owns()). CSRF protection is exactly what keeps cookie-authenticated requests safe, so a session-dependent endpoint that disables it is forgeable.
      Fixes: keep CSRF protection (remove csrf: false) for any session-authenticated endpoint; or, if the endpoint is a genuine third-party callback, authenticate it by a signature verifier instead of the session and drop the session-derived guard.
      SPEC §9.1 makes a csrf: false endpoint that depends on the session a compile error.",
          "message": "csrf-exempt endpoint depends on the session (forgeable).",
          "severity": "error",
        },
        "KV419": {
          "code": "KV419",
          "help": "Would lower to: a speculationrules prerender that renders this route server-side, with the user's credentials, on hover/pointerdown.
      Blocked reason: prefetch "moderate" prerenders a guarded (session-dependent) route, which executes its render — and any per-user side effects — for a navigation that may be discarded.
      Fixes: use prefetch "conservative" (prefetch document bytes, no prerender) or false; restrict prefetch "moderate" to public, idempotent routes; or remove the guard if the route is genuinely public.
      SPEC §8 requires auto-prerender to be opt-in only where renders are idempotent and not session-dependent.",
          "message": "prefetch "moderate" prerenders a guarded, session-dependent route.",
          "severity": "error",
        },
        "KV420": {
          "code": "KV420",
          "help": "Would lower to: a full-subtree re-render from (declared queries ∪ stamped props) on every fragment patch of the enclosing server-refreshable target.
      Blocked reason: the fragment morph carries no serialization of island-local kovo-state (§9.1), so re-emitting the enclosing target would reset the nested island to its render-time default and clobber the child's live local state.
      Fixes: lift the child's state into a declared query so it travels in the refreshable channel, mark the child isomorphic: true so it self-renders rather than being server-refreshed (§4.8), set disableServerRefresh: true on the enclosing component so the child reclassifies under §4.9, or move the stateful island outside the refreshable target.
      SPEC §4.5/§4.9/§9.1 forbid an island declaring local state from rendering inside another component's inferred server-refreshable fragment target.
      Escape: document-lifetime-immutable local state is renderOnce and does not trip KV420.",
          "message": "Island with local state nested inside a server-refreshable fragment target loses its state on refresh.",
          "severity": "error",
        },
        "KV421": {
          "code": "KV421",
          "help": "Would lower to: one mutation fact per mutation key for the invalidation registry and server dispatch table.
      Blocked reason: two mutation declarations share one key, so graph indexing silently last-write-wins the invalidation set while server dispatch first-match-wins the handler — the two layers disagree, an invalidation can be computed for a mutation that never runs, and the wrong handler (with the wrong input schema and guards) executes against attacker-shaped input.
      Fixes: emit exactly one mutation fact per mutation key, or rename one mutation so its key is unique across the app graph.
      SPEC §6.1 makes the mutation registry key-addressed and §9.5 dispatches a POST to exactly one keyed handler; duplicate mutation keys would otherwise silently last-write-wins the invalidation registry while first-match-wins server dispatch — like routes (KV228), components (KV237), fragment targets (KV238), view transitions (KV239), and query shapes (KV240), mutation keys must be unique.",
          "message": "Duplicate mutation key.",
          "severity": "error",
        },
        "KV422": {
          "code": "KV422",
          "help": "Would lower to: SQL text and SQL values crossing the managed DB seam as separate facts.
      Blocked reason: executable SQL text was built from an unbranded raw string, an unsafe raw chunk, or an unchecked identifier/keyword fragment, so request data could become SQL syntax instead of a bound value.
      Fixes: use Drizzle builders or Kovo sql\`...\` placeholders for scalar values, staticSql\`...\` for literal-only SQL text, sql.identifier(value, { allow }) or sql.allow(value, allowlist) for allowlisted identifiers/keywords, or trustedSql(..., { justification }) for the audited raw-SQL escape hatch.
      SPEC §10.2/§10.3 and §11.2 require framework-managed DB handles to reject unbranded executable SQL text independently from KV406/KV410 read/write freshness declarations.",
          "message": "SQL text injection risk.",
          "severity": "error",
        },
        "KV423": {
          "code": "KV423",
          "help": "Would lower to: a raw endpoint audit row with explicit method, purpose/reason, mount scope, response body posture, cache posture, and app-owned encoding/header-safety declarations.
      Blocked reason: endpoint() is the raw HTTP escape hatch; without complete audit metadata, reviewers cannot tell why the route exists, what methods it accepts, or who owns output/header safety.
      Fixes: add the missing endpoint metadata, give prefix mounts a mountJustification, and keep csrf:false justifications separate from the endpoint purpose.
      SPEC §9.1 makes raw endpoint ingress registry-visible, and the source/sink inventory requires every raw endpoint to explain its trust and output posture.",
          "message": "Raw endpoint declaration is missing required audit metadata.",
          "severity": "error",
        },
        "KV424": {
          "code": "KV424",
          "help": "Would lower to: a framework-owned safe helper, typed trust API, or registered source/sink row for the dangerous output operation.
      Blocked reason: app-authored direct writes to dangerous sinks such as raw HTML, URL/navigation, selectors, headers, files, dynamic import, eval, or process execution bypass Kovo contextual encoding and audit surfaces.
      Fixes: route the value through the corresponding Kovo helper, use an explicit trustedHtml/trustedUrl-style escape hatch with provenance, or move app-owned raw protocol code behind an audited endpoint.
      SPEC §4.8, §5.2 rule 10, and §9.1 require dangerous sinks to be safe-by-default or explicit in the source/sink inventory.",
          "message": "App-authored dangerous sink is not registered or behind a safe Kovo surface.",
          "severity": "error",
        },
        "KV425": {
          "code": "KV425",
          "help": "Would lower to: a source/sink registry entry, runtime chokepoint, diagnostic, or explicit repo-internal exclusion for each dangerous framework sink token found by drift detection.
      Blocked reason: a new framework-owned sink appeared without being enrolled in the generated source/sink inventory, so future audits can miss a path from attacker-controlled input to output.
      Fixes: add the sink to the shared registry with spec/test evidence, attach it to an existing safe chokepoint, or record a narrow exclusion proving it is build/test-only or outside request paths.
      The source/sink plan requires drift detection for sink tokens such as innerHTML, Headers, Location, Set-Cookie, querySelector, import(), new Function, child_process, fs, and path resolution.",
          "message": "Framework source/sink registry drift detected an unregistered sink.",
          "severity": "error",
        },
        "KV426": {
          "code": "KV426",
          "help": "Would lower to: a trust-audit row naming the escape hatch, source span, justification, and owning safe path or app review boundary.
      Blocked reason: raw endpoint, trustedHtml/trustedUrl, custom/no verifier, static export path override, or future trustedSql use without provenance becomes invisible to kovo explain --trust.
      Fixes: add a named justification/source span, use a typed safe helper instead of the escape hatch, or remove the trust override.
      SPEC §4.8 and §9.1 allow trust escape hatches only when they are explicit and auditable.",
          "message": "Trust escape hatch lacks auditable provenance.",
          "severity": "error",
        },
        "KV427": {
          "code": "KV427",
          "help": "Blocked reason: a cloud SDK client was constructed without the declared Kovo cloud credential wrapper, so metadata credentials could be fetched through an untracked path.
      Fixes: declare the cloud provider capability, construct clients with the corresponding kovo cloud credential helper, or remove the SDK client.
      Escape: provider-specific credential helpers enter the framework metadata capability frame; arbitrary metadata egress remains blocked.
      The secure-by-construction Phase 5 egress model requires cloud credentials to flow through framework-owned credential factories instead of raw SDK defaults.",
          "message": "Cloud SDK client is missing its declared framework credential.",
          "severity": "error",
        },
        "KV428": {
          "code": "KV428",
          "help": "Blocked reason: uploaded attacker-controlled bytes would be rendered inline without a verified-safe content type or framework re-encode step.
      Fixes: serve the upload as attachment with nosniff, re-encode it through a safe framework transform, or use an audited inline-upload escape with provenance.
      Escape: an explicit inline upload escape is audit-grade only and must appear in kovo explain capabilities.
      The secure-by-construction Phase 6 upload gate protects the active-content boundary; user filenames and client MIME claims are metadata, not proof.",
          "message": "Unverified uploaded content cannot be rendered inline.",
          "severity": "error",
        },
        "KV429": {
          "code": "KV429",
          "help": "Blocked reason: a mutation reads and then writes a declared atomic/versioned value without a compare-and-set, version check, row lock, or serializable transaction proof.
      Fixes: use the Kovo optimistic version helper, compare-and-set primitive, forUpdate/SERIALIZABLE transaction, or remove the stale read-before-write dependency.
      Escape: explicit lock/serializable primitives document the concurrency boundary; a plain mutation transaction is not enough under READ COMMITTED.
      SPEC §11.1 and secure-by-construction Phase 6 require contended writes to carry an atomicity proof instead of relying on timing.",
          "message": "Read-then-write on an atomic value lacks an atomicity guard.",
          "severity": "error",
        },
        "KV430": {
          "code": "KV430",
          "help": "Blocked reason: an untrusted wire schema admits recursive depth, array length, record breadth, or total node count without an explicit budget.
      Fixes: add max depth/length/keys limits to the schema, rely on the default parser budget when appropriate, or raise the app-level budget with a reviewed reason.
      Escape: schema or app-level budget overrides are audited capacity decisions, not proof that the input is small.
      The secure-by-construction Phase 6 parser budget closes small-body/large-work inputs before schema descent across JSON, FormData, query, and route params.",
          "message": "Wire schema has no explicit shape budget.",
          "severity": "lint",
        },
        "KV431": {
          "code": "KV431",
          "help": "Would lower to: a static/export client-module manifest containing every client module URL referenced by route documents.
      Blocked reason: a route document references a client module that cannot be replayed as immutable same-origin JavaScript, so a static host or CSP manifest would publish an incomplete client runtime.
      Fixes: reference production versioned /c/__v/... client module URLs emitted by Kovo, keep one immutable version per output path, or remove the stale client module reference.
      SPEC §6.6 and §9.5 require client module references to stay same-origin, immutable, and complete under the framework's CSP/export manifest.",
          "message": "Client module reference is absent from the CSP/export manifest.",
          "severity": "error",
        },
        "KV432": {
          "code": "KV432",
          "help": "Blocked reason: a session/auth-reachable cookie weakens HttpOnly, Secure, or SameSite floors without a recorded unsafeCookie justification.
      Fixes: keep the class-derived cookie floor, route forwarded Set-Cookie values through the normalizer, or attach unsafeCookie downgrade metadata with a specific justification.
      Escape: unsafeCookie records the downgrade in kovo explain --cookies; it does not make the cookie attribute safe.
      SPEC §6.5 and secure-by-construction Phase 5 require cookie security floors to be explicit and auditable rather than copied from app or provider strings.",
          "message": "Insecure cookie downgrade lacks an unsafeCookie justification.",
          "severity": "error",
        },
        "KV433": {
          "code": "KV433",
          "help": "Blocked reason: a query loader reaches a write-capable database operation without the explicit elevated query capability.
      Fixes: keep query loaders on the read-only DB handle, move writes to a mutation, or use query.elevated with a reviewed reason when the read path must hold a write capability.
      Escape: query.elevated is an audited capability and should remain rare because GET/query execution is expected to be read-only.
      SPEC §10.2 and secure-by-construction Phase 5 require read surfaces to lack write authority by default, with a static write-reachability gate as the completion target.",
          "message": "Query loader reaches a write without an elevated query capability.",
          "severity": "error",
        },
        "KV434": {
          "code": "KV434",
          "help": "Blocked reason: s.string().pattern(...) accepts only compile-visible string literals whose regex structure is conservatively linear-safe; dynamic patterns and nested or overlapping quantified structures can cause catastrophic backtracking.
      Fixes: use a blessed validator such as email(), url(), uuid(), or slug(); replace the pattern with a simpler literal-safe expression; or wrap a reviewed RegExp in unsafeRegex(re, justification) so the ReDoS risk is explicit in kovo explain --capabilities.
      Escape: unsafeRegex(re, justification) is audited and makes the app-owned ReDoS risk explicit.
      SPEC §6.3 and the secure-by-construction Phase 6 plan require request wire validators to avoid app-provided exponential regular expressions by default.",
          "message": "Non-linear-safe pattern literal in a wire string validator.",
          "severity": "error",
        },
        "KV435": {
          "code": "KV435",
          "help": "Would lower to: a client-readable kovo-query payload embedded in the document and hydrated by the browser query store.
      Blocked reason: the projected query shape contains a secret-classified field, or an opaque/unresolved projection reads a table carrying secret columns, so rendering this query could serialize confidential data onto the client wire.
      Fixes: remove the secret field or opaque projection, select explicit non-secret columns, select a non-secret surrogate, or add an explicit reveal/redaction escape once the audited reveal surface lands.
      SPEC §6.2, §10.2, and §11.3 make query results JsonValue-bounded client wire values; a secret-classified or unprovable secret-table projection is ineligible for that boundary.",
          "message": "Secret query value reaches the client wire.",
          "severity": "error",
        },
        "KV436": {
          "code": "KV436",
          "help": "Would lower to: a query, mutation, route, endpoint, or webhook with a total access decision recorded in the app graph.
      Blocked reason: the surface has no explicit access decision, so review cannot distinguish an intentional public or machine-verified entry from an accidentally reachable handler.
      Fixes: add an access guard chain, public("reason"), or verified machine-auth decision; use kovo explain --access to inspect the ledger before enabling the strict gate.
      SPEC §10.2/§11.3 and the secure-by-construction Phase 2 plan require authorization to be default-deny through explicit access decisions, not through inferred defaults.",
          "message": "Missing explicit access decision.",
          "severity": "error",
        },
        "KV437": {
          "code": "KV437",
          "help": "Would lower to: a Drizzle write whose governed columns are assigned only from literals, current row values, or proven server/private-scope values.
      Blocked reason: client input or unproven data can assign an owner, primary key, or explicitly governed column, which would bypass the table-level ownership and identity facts declared once in schema.
      Fixes: derive owner/identity values on the server, remove governed keys from client payload writes, replace spreads/whole-object values with explicit non-governed fields, or use the audited adminAssign escape once it lands.
      SPEC §10.1, §10.3, and §11.1 make owner columns and primary keys governed write boundaries, proven by symbol provenance rather than lexical source matching.",
          "message": "Client input reaches a governed column write.",
          "severity": "error",
        },
      }
    `);
  });

  it('requires class-specific teaching help for every compiler-owned diagnostic', () => {
    type CompilerTeachingCode = keyof typeof compilerDiagnosticTeachingSchemas;
    const compilerDiagnosticCodes = Object.keys(diagnosticDefinitions).filter(
      (code): code is CompilerTeachingCode =>
        code === 'KV201' || code === 'KV429' || code === 'KV434' || /^KV[23]\d\d$/.test(code),
    );

    expect(compilerDiagnosticCodes).not.toEqual([]);
    expect(Object.keys(compilerDiagnosticTeachingSchemas).sort()).toEqual(
      compilerDiagnosticCodes.sort(),
    );

    for (const code of compilerDiagnosticCodes) {
      const definition = diagnosticDefinitions[code];
      const help = (definition as { help?: string }).help;
      const schema = compilerDiagnosticTeachingSchemas[code];
      const labels = Object.values(
        'detailLabels' in definition ? definition.detailLabels : {},
      ).join('\n');

      expect(definition.message, `${code} states the problem`).toEqual(expect.any(String));
      expect(definition.message.trim(), `${code} states the problem`).not.toBe('');
      expect(help, `${code} has teaching help`).toEqual(expect.any(String));
      expect(help, `${code} names concrete fixes`).toContain('Fixes:');
      expect(help, `${code} cites the normative SPEC section`).toContain('SPEC §');

      if (schema.blockedReason) {
        expect(help, `${code} explains why lowering is blocked or degraded`).toContain(
          'Blocked reason:',
        );
      }

      if (schema.loweredForm === 'required') {
        expect(`${help}\n${labels}`, `${code} shows the would-have-lowered form`).toMatch(
          /Would (?:lower|hoist) (?:to|children to):/,
        );
      }

      if (schema.escapePosture === 'documented') {
        expect(help, `${code} documents suppression or escape posture`).toMatch(
          /(?:Escape:|no suppression|advisory|lint-level|compilation continues|intentional)/,
        );
      }
    }
  });

  it('renders registry messages with optional help text for diagnostic consumers', () => {
    expect(diagnosticDefinitionText('KV407', { includeHelp: true })).toBe(
      'Query read from undeclared domain. No mutation touch graph writes that domain.',
    );
    expect(diagnosticDefinitionText('KV410', { preferHelp: true })).toBe(
      'Opaque query projection requires a declared output schema.',
    );
  });

  it('does not accept inherited property names as diagnostic codes', () => {
    expect(isDiagnosticCode('toString')).toBe(false);
    expect(isDiagnosticCode('__proto__')).toBe(false);
  });
});
