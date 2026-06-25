import {
  diagnosticDefinitions,
  type DiagnosticCode,
  type DiagnosticSeverity,
} from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import {
  compilerOwnedDiagnosticMatrix,
  outOfScopeCompilerDiagnostics,
} from './diagnostic-coverage-matrix.data.js';
import type { CompilerDiagnostic } from './diagnostics.js';

interface DiagnosticSnapshotFact {
  code: DiagnosticCode;
  fileName: string;
  help: string | null;
  length: number | null;
  message: string;
  severity: DiagnosticSeverity;
  start: { column: number; line: number } | null;
}

describe('compiler diagnostic coverage matrix', () => {
  it('guards the authoritative compiler-owned diagnostic code list', () => {
    expect(matrixCodes()).toEqual(
      allCompilerOwnedDiagnosticCodes().filter((code) => !outOfScopeCodeSet().has(code)),
    );
    expect(
      [...matrixCodes(), ...outOfScopeCompilerDiagnostics.map((row) => row.code)].sort(),
    ).toEqual(allCompilerOwnedDiagnosticCodes());
    expect(outOfScopeCompilerDiagnostics).toMatchInlineSnapshot(`
      [
        {
          "code": "KV310",
          "reason": "Compiler-owned, but emitted by the optimistic coverage/check path (\`tests/kovo-check.node.mjs\`) rather than compileComponentModule/deriveAppGraph/query-shape validation.",
        },
        {
          "code": "KV314",
          "reason": "Compiler-owned, but emitted by the kovo check coverage graph path (\`packages/cli/src/index.kovo-check.test.ts\`) rather than compileComponentModule/deriveAppGraph/query-shape validation.",
        },
        {
          "code": "KV422",
          "reason": "Security-heavy, but produced by the Drizzle/static SQL analyzer and carried through compile/check graph diagnostics rather than by component compilation or app graph derivation.",
        },
        {
          "code": "KV423",
          "reason": "Security-heavy, but raw endpoint metadata ownership currently lives in server/check graph producers; no compiler-owned row is claimed until endpoint extraction is compiler-derived.",
        },
        {
          "code": "KV424",
          "reason": "Security-heavy, but produced by source/sink and kovo check graph diagnostics for app-authored dangerous sinks rather than component compilation.",
        },
        {
          "code": "KV425",
          "reason": "Security-heavy, but source/sink drift detection is a repository audit/check path, not compiler component or registry graph output.",
        },
        {
          "code": "KV426",
          "reason": "Security-heavy, but trust-escape provenance is surfaced by kovo explain/check graph paths; component compilation only preserves facts when supplied.",
        },
        {
          "code": "KV428",
          "reason": "Security-heavy, but upload content-disposition/type enforcement is runtime/server-owned and not emitted by the compiler diagnostic path.",
        },
        {
          "code": "KV429",
          "reason": "Security-heavy, but lost-update write provenance is enforced by kovo check graph diagnostics, not component compilation.",
        },
        {
          "code": "KV430",
          "reason": "Security-heavy, but schema breadth/depth budget linting is schema/check ownership and not emitted by component compilation.",
        },
        {
          "code": "KV431",
          "reason": "Security-heavy, but client-module manifest completeness is deployment/check ownership rather than compiler-owned component diagnostics.",
        },
        {
          "code": "KV432",
          "reason": "Security-heavy, but cookie-attribute floors are server/runtime sink ownership rather than compiler-owned component diagnostics.",
        },
        {
          "code": "KV433",
          "reason": "Security-heavy, but write-reaching query loaders are enforced by kovo check graph diagnostics, not component compilation.",
        },
        {
          "code": "KV434",
          "reason": "Security-heavy, but regex/schema analyzer ownership is outside the compiler component/registry diagnostic matrix.",
        },
        {
          "code": "KV436",
          "reason": "Security-heavy, but the compiler derives access facts while kovo check consumes undecided facts as KV436 diagnostics.",
        },
        {
          "code": "KV438",
          "reason": "Security-heavy, but governed-column mass-assignment is enforced by kovo check graph diagnostics rather than compiler-owned component or registry diagnostics.",
        },
      ]
    `);
  });

  it('proves every in-scope compiler-owned diagnostic has positive and negative coverage', () => {
    const coverageFacts = compilerOwnedDiagnosticMatrix.map((row) => {
      const positiveDiagnostics = row
        .positive()
        .filter((diagnostic) => diagnostic.code === row.code);
      const negativeDiagnostics = row
        .negative()
        .filter((diagnostic) => diagnostic.code === row.code);

      expect(
        positiveDiagnostics,
        `${row.code} accepted-path fixture should not emit ${row.code} (${row.spec}).`,
      ).toEqual([]);
      expect(
        negativeDiagnostics.length,
        `${row.code} negative fixture should emit ${row.code} (${row.spec}).`,
      ).toBeGreaterThan(0);

      return {
        code: row.code,
        negativeCount: negativeDiagnostics.length,
        positiveCount: positiveDiagnostics.length,
        spec: row.spec,
      };
    });

    expect(coverageFacts).toMatchInlineSnapshot(`
      [
        {
          "code": "KV201",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.3/§5.2",
        },
        {
          "code": "KV210",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §5.2",
        },
        {
          "code": "KV211",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.7",
        },
        {
          "code": "KV212",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.7",
        },
        {
          "code": "KV220",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.4/§9.5",
        },
        {
          "code": "KV221",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5/§6.4",
        },
        {
          "code": "KV222",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8",
        },
        {
          "code": "KV223",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8",
        },
        {
          "code": "KV224",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5",
        },
        {
          "code": "KV225",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.2",
        },
        {
          "code": "KV226",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §5.2",
        },
        {
          "code": "KV227",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8",
        },
        {
          "code": "KV228",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §9.5",
        },
        {
          "code": "KV230",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5",
        },
        {
          "code": "KV231",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.6",
        },
        {
          "code": "KV232",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.6",
        },
        {
          "code": "KV317",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.6",
        },
        {
          "code": "KV233",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.6/§4.8",
        },
        {
          "code": "KV234",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.1.1",
        },
        {
          "code": "KV235",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §5.2",
        },
        {
          "code": "KV244",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §8",
        },
        {
          "code": "KV245",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §5.2",
        },
        {
          "code": "KV236",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §1/§5.2",
        },
        {
          "code": "KV237",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.1.1",
        },
        {
          "code": "KV238",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5/§6.2",
        },
        {
          "code": "KV242",
          "negativeCount": 2,
          "positiveCount": 0,
          "spec": "SPEC.md §6.2/§6.3",
        },
        {
          "code": "KV243",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §9.1",
        },
        {
          "code": "KV239",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §8",
        },
        {
          "code": "KV240",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8",
        },
        {
          "code": "KV241",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.2/§4.8",
        },
        {
          "code": "KV301",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.1",
        },
        {
          "code": "KV302",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8/§6.2",
        },
        {
          "code": "KV303",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5",
        },
        {
          "code": "KV304",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8",
        },
        {
          "code": "KV311",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.9",
        },
        {
          "code": "KV312",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8/§4.9",
        },
        {
          "code": "KV315",
          "negativeCount": 2,
          "positiveCount": 0,
          "spec": "SPEC.md §4.8/§4.9",
        },
        {
          "code": "KV316",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5/§4.8",
        },
        {
          "code": "KV320",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.4",
        },
        {
          "code": "KV330",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §11.4/§14",
        },
        {
          "code": "KV420",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §4.5/§4.9/§9.1",
        },
        {
          "code": "KV421",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.1/§9.5",
        },
        {
          "code": "KV435",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.2/§6.6/§10.2",
        },
        {
          "code": "KV437",
          "negativeCount": 1,
          "positiveCount": 0,
          "spec": "SPEC.md §6.2/§6.6",
        },
      ]
    `);
  });

  it('snapshots representative compiler-owned diagnostics with file, position, length, message, and help', () => {
    const diagnosticFacts = compilerOwnedDiagnosticMatrix.map((row) => {
      const diagnostic = representativeDiagnostic(row.code, row.negative());
      return snapshotDiagnostic(diagnostic);
    });

    expect(diagnosticFacts).toMatchInlineSnapshot(`
      [
        {
          "code": "KV201",
          "fileName": "handler-captures-bad.tsx",
          "help": "Would lower to: on:click="/c/__v/<version>/handler-captures-bad.client.js#HandlerCapturesBad$button_click"
      Blocked expression: () => window.alert("x")
      Element params: -
      Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.
      Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.
      Blocked reason: captured runtime values cannot be serialized into the generated handler module boundary.
      SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.",
          "length": 8,
          "message": "Closure captures unserializable value.",
          "severity": "error",
          "start": {
            "column": 9,
            "line": 1,
          },
        },
        {
          "code": "KV210",
          "fileName": "handler-name-bad.tsx",
          "help": "Would lower to: a generated Component$element_event handler export with a stable source-derived URL.
      Blocked reason: anonymous handler identity is less stable for generated artifacts, explanations, and agent repairs.
      Fixes: extract a named function in module scope or reference a named local handler from the JSX event.
      SPEC §5.2 requires readable, source-derived emitted names; this lint is advisory and has no suppression beyond accepting the generated fallback name.",
          "length": 5,
          "message": "Anonymous handler; name it for stable identity.",
          "severity": "lint",
          "start": {
            "column": 25,
            "line": 4,
          },
        },
        {
          "code": "KV211",
          "fileName": "trigger-load-bad.tsx",
          "help": "Blocked reason: on:load runs at parse time and adds eager JavaScript to the page budget.
      Fixes: use a user/event trigger instead, or attach an adjacent KV211 justification comment when parse-time execution is intentional.
      SPEC §4.7 keeps on:load grep-visible as the eager-JS escape hatch.
      Escape: an attached KV211 justification comment preserves the lint trail without blocking compilation.",
          "length": 7,
          "message": "on:load eager trigger requires a justification comment. on:load",
          "severity": "lint",
          "start": {
            "column": 31,
            "line": 3,
          },
        },
        {
          "code": "KV212",
          "fileName": "trigger-known-bad.tsx",
          "help": "Blocked reason: unknown on:* triggers cannot be mapped to the closed event/trigger vocabulary the loader understands.
      Fixes: use a DOM event name, use one of Kovo's declared execution triggers, or move the behavior into a component primitive that owns the attribute.
      SPEC §4.7 requires declared execution so generated artifacts remain auditable.",
          "length": 8,
          "message": "Unknown on:* event or execution trigger name. on:media",
          "severity": "lint",
          "start": {
            "column": 31,
            "line": 3,
          },
        },
        {
          "code": "KV220",
          "fileName": "navigation-bad.tsx",
          "help": "Would lower to: a route-checked href/action that participates in the typed route registry.
      Blocked reason: the literal target does not match any declared canonical route path.
      Fixes: use a typed route helper, declare the route, correct the literal path, or mark an intentional full-origin/external navigation with the external escape hatch.
      SPEC §6.4 and §9.5 require navigation targets to stay type-checked against the route table.
      Escape: external/full-origin URLs opt out because they are outside the app route graph.",
          "length": 16,
          "message": "Literal href or form action matches no declared route. /checkout",
          "severity": "error",
          "start": {
            "column": 20,
            "line": 3,
          },
        },
        {
          "code": "KV221",
          "fileName": "idref-bad.tsx",
          "help": "Would lower to: light-DOM IDREF wiring whose target id exists in the same component scope.
      Blocked reason: the referenced id is absent, outside the validated scope, or hidden behind a different component boundary.
      Fixes: add the target id in this component scope, pass a generated id through props, or correct the IDREF attribute value.
      SPEC §4.5 and §6.4 require IDREFs such as commandfor, popovertarget, for, and aria-* to resolve at compile time.",
          "length": 13,
          "message": "IDREF references an id not present in component scope. missing",
          "severity": "error",
          "start": {
            "column": 24,
            "line": 3,
          },
        },
        {
          "code": "KV222",
          "fileName": "binding-drift-bad.tsx",
          "help": "Would lower to: the compiler-derived data-bind stamp for the typed JSX expression.
      Blocked reason: a hand-written stamp names a different path than the expression it wraps, so server render and client update semantics could drift.
      Fixes: remove the hand-written stamp and let the compiler derive it, or make the stamp path exactly match the typed expression.
      SPEC §4.8 treats typed expressions and binding stamps as one fact and rejects drift.",
          "length": 22,
          "message": "Hand-written binding stamp disagrees with the typed expression it wraps. data-bind="cart.total" wraps {cart.count}",
          "severity": "error",
          "start": {
            "column": 31,
            "line": 4,
          },
        },
        {
          "code": "KV223",
          "fileName": "binding-redundancy-bad.tsx",
          "help": "Would lower to: the same data-bind stamp the author already wrote by hand.
      Blocked reason: the stamp is redundant in app-authored TSX because the compiler can derive it from the typed expression.
      Fixes: remove the hand-written data-bind stamp and keep the typed JSX expression as the source of truth.
      SPEC §4.8 permits residual stamps for emitted IR fixpoint validation, but app TSX should not hand-author derivable stamps.
      Escape: emitted compiler artifacts may retain residual stamps for fixpoint checks; app source should use TSX sugar.",
          "length": 22,
          "message": "Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}",
          "severity": "lint",
          "start": {
            "column": 31,
            "line": 4,
          },
        },
        {
          "code": "KV224",
          "fileName": "ids-bad.tsx",
          "help": "Blocked reason: duplicate static ids make IDREF proofs ambiguous, and static ids inside repeatable stamps can produce multiple elements with the same id.
      Fixes: generate ids from props/kovo-key, move the id outside the repeatable subtree, or pass a unique id down to the component.
      SPEC §4.5 requires ids to be unique by construction so KV221 IDREF validation remains meaningful.",
          "length": 10,
          "message": "Static id is duplicated in component scope or appears inside a repeatable stamp. duplicate id="title"",
          "severity": "error",
          "start": {
            "column": 55,
            "line": 3,
          },
        },
        {
          "code": "KV225",
          "fileName": "markup-bad.tsx",
          "help": "Would lower to: HTML whose parsed DOM preserves the authored JSX tree.
      Blocked reason: the HTML parser would re-parent or drop invalid children, changing morph identity and fragment targets after serving.
      Fixes: use content-model-valid wrapper elements, move table rows into table/section parents, or split paragraph/block content into valid siblings.
      SPEC §4.2 requires compiler-served HTML and parsed DOM shape to agree.",
          "length": 5,
          "message": "JSX nesting violates the HTML content model. <div> cannot appear inside <p>",
          "severity": "error",
          "start": {
            "column": 20,
            "line": 3,
          },
        },
        {
          "code": "KV226",
          "fileName": "residual-bad.tsx",
          "help": "Would lower to: emitted IR stamps whose kovo-c and kovo-deps names resolve to known components and query instances.
      Blocked reason: residual compiler stamps reference a component or query that is not present in the module/registry facts.
      Fixes: recompile from TSX source, correct the generated stamp, or add the missing component/query fact to the compile graph.
      SPEC §5.2 allows lowered IR only as compiler output/fixpoint input, and fixpoint validation must reject stale names.",
          "length": 26,
          "message": "kovo-deps or kovo-c names an unknown query instance or component. kovo-c="unknown-component"",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 6,
          },
        },
        {
          "code": "KV227",
          "fileName": "nullable-bad.tsx",
          "help": "Blocked reason: the binding path crosses a nullable query segment without declaring empty-on-null behavior.
      Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.
      SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.",
          "length": 32,
          "message": "Binding path traverses a nullable segment without ?. product.details.name (segment: details)",
          "severity": "error",
          "start": {
            "column": 23,
            "line": 3,
          },
        },
        {
          "code": "KV228",
          "fileName": "app graph route table",
          "help": "Blocked reason: static-first route matching cannot choose a single canonical handler for at least one request path.
      Fixes: remove duplicate route facts, split overlapping patterns, add a static segment, or make one route path more specific.
      SPEC §9.5 requires route matching to be unambiguous at compile time.",
          "length": null,
          "message": "Ambiguous route table: two routes can match the same canonical request path or duplicate route path. duplicate route path "/cart" appears 2 times in graph pages.",
          "severity": "error",
          "start": null,
        },
        {
          "code": "KV230",
          "fileName": "fragment-children-bad.tsx",
          "help": "Would hoist children to: CartRow$slot_children
      Blocked children: <span>{escapeText(snapshot.total)}</span>
      Blocked reason: fragment responses must fully describe the DOM they produce, but these children cannot be hoisted through serializable props.
      Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.
      SPEC §4.5 requires fragment-target children to lower to component references when they cross the target boundary.",
          "length": 41,
          "message": "Fragment-target children cannot lower to a component reference. CartRow",
          "severity": "error",
          "start": {
            "column": 11,
            "line": 19,
          },
        },
        {
          "code": "KV231",
          "fileName": "attribute-conflict-bad.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 19,
          "message": "Unmergeable attribute conflict in primitive composition. commandfor",
          "severity": "error",
          "start": {
            "column": 25,
            "line": 3,
          },
        },
        {
          "code": "KV232",
          "fileName": "attribute-override-bad.tsx",
          "help": "Would lower to: author-visible override of a primitive-owned ARIA, role, or state attribute.
      Blocked reason: the override is allowed but can change accessibility semantics or be clobbered by runtime-updated primitive state.
      Fixes: prefer the primitive API, remove the override, or keep it intentionally and audit the generated merge explanation.
      SPEC §4.6 keeps this override as a lint-level escape hatch so author intent stays visible.
      Escape: compilation continues; the lint documents the override for review.",
          "length": 11,
          "message": "Author overrides a primitive-owned ARIA or state attribute. role",
          "severity": "lint",
          "start": {
            "column": 39,
            "line": 3,
          },
        },
        {
          "code": "KV317",
          "fileName": "state-aria-contradiction.tsx",
          "help": "Would lower to: a static state-bearing ARIA attribute whose author value contradicts the primitive's render-time state.
      Blocked reason: state aria-* (aria-expanded/selected/checked/pressed/current, state-driven aria-disabled) is primitive-wins; the primitive's runtime derive keeps writing it, so a static author value that disagrees with the render-time state is a frozen-vs-clobbered ambiguity the author cannot have meant — distinct from the visible-override lint KV232.
      Fixes: drop the contradicting static value (let the primitive own it) or set it to match the primitive's render-time state.
      SPEC §4.6 makes a contradicting static state aria-* an error (KV317), not the override lint (KV232).",
          "length": 21,
          "message": "Static state-bearing aria-* value contradicts the primitive's render-time state. aria-expanded (writers: primitive attrs, author JSX)",
          "severity": "error",
          "start": {
            "column": 40,
            "line": 6,
          },
        },
        {
          "code": "KV233",
          "fileName": "binding-slot-bad.tsx",
          "help": "Would lower to: exactly one writer for each data-bind target slot.
      Blocked reason: multiple bindings target the same text/attribute slot, so the client loader cannot choose a single update source.
      Fixes: keep one binding, split values across distinct elements/attributes, or combine the values in a named derive before binding.
      SPEC §4.6 and §4.8 require binding slots to have a single writer.",
          "length": 22,
          "message": "Two writers target the same binding slot. data-bind",
          "severity": "error",
          "start": {
            "column": 23,
            "line": 3,
          },
        },
        {
          "code": "KV234",
          "fileName": "prefix-bad.tsx",
          "help": "Would lower to: package-scoped component names, CSS scopes, and behavior attributes using one effective prefix.
      Blocked reason: the prefix is missing, invalid, duplicated, or reserves kovo-* outside @kovojs/* packages.
      Fixes: assign a lowercase dash-terminated unique prefix, alias one package, or use kovo-* only for framework packages.
      SPEC §6.1.1 requires app-wide unique package component prefixes.
      SPEC §6.1.1 reserves the kovo-* prefix family for packages whose manifest name is in the @kovojs/* scope.
      SPEC §6.1.1 reserves the kovo-* attribute namespace for framework-owned attributes and future loader/compiler growth.
      Fix: choose a non-reserved prefix, or add an explicit app-side alias such as "acme-kovo-".",
          "length": null,
          "message": "Package component prefix registration conflict or reservation violation. @acme/widgets cannot use reserved kovo-* package prefix "kovo-".",
          "severity": "error",
          "start": null,
        },
        {
          "code": "KV235",
          "fileName": "authoring-surface-bad.tsx",
          "help": "Blocked reason: app source is hand-authoring lowered string/render IR instead of TSX.
      Fixes: write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.
      SPEC §5.2: TSX is the sole app-authoring surface.
      Escape: there is no v1 suppression or ejection workflow for hand-authored lowered IR.
      TSX equivalent direction: render with JSX, for example \`render: (...) => (<cart-badge>...</cart-badge>)\`, and use typed expressions such as \`{cart.count}\` instead of data-bind strings.",
          "length": 93,
          "message": "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.",
          "severity": "error",
          "start": {
            "column": 25,
            "line": 4,
          },
        },
        {
          "code": "KV244",
          "fileName": "defer-jsx-bad.tsx",
          "help": "Would lower to: <Defer target="..." fallback={...} render={...} /> emitting a framework-owned <kovo-defer> placeholder.
      Blocked reason: defer() is an internal string-composition helper; as a JSX child it bypasses JSX fallback escaping and can render framework markup as text.
      Fixes: import Defer from @kovojs/server and render <Defer ... /> with JSX fallback content, or keep raw HTML behind an explicit trustedHtml(...) boundary outside JSX child position.
      SPEC §8 makes Defer the public route-region deferral API and keeps raw string composition internal.
      Escape: trustedHtml(...) remains the explicit raw-HTML escape hatch, but app JSX children should use <Defer>.",
          "length": 93,
          "message": "defer() used as a JSX child; use <Defer> instead. defer(...)",
          "severity": "lint",
          "start": {
            "column": 24,
            "line": 5,
          },
        },
        {
          "code": "KV245",
          "fileName": "parse-bad.tsx",
          "help": "Would lower to: typed JSX facts before generated server, client, CSS, and registry artifacts.
      Blocked reason: TypeScript could not parse the authored TSX, so later compiler phases would operate on a recovery tree.
      Fixes: correct the TSX syntax at this location and re-run the compiler.
      SPEC §5.2 requires app source to be TSX and generated artifacts to come only from parsed compiler facts.",
          "length": 4,
          "message": "TypeScript/TSX parse failed. JSX element 'span' has no corresponding closing tag.",
          "severity": "error",
          "start": {
            "column": 27,
            "line": 3,
          },
        },
        {
          "code": "KV236",
          "fileName": "output-context-bad.tsx",
          "help": "Blocked reason: the output context can execute script, navigate unexpectedly, inject unsafe CSS, or bypass normal JSX escaping.
      Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.
      SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.",
          "length": 26,
          "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. href="javascript:alert(1)" uses an unsafe URL scheme",
          "severity": "error",
          "start": {
            "column": 20,
            "line": 3,
          },
        },
        {
          "code": "KV237",
          "fileName": "component-name-bad.tsx",
          "help": "Would lower to: one derived component registry key per component across the app graph.
      Blocked reason: duplicate derived registry keys make component identity, CSS scoping, fragment routing, and graph facts ambiguous.
      Fixes: rename the exported component binding, or move one component so its derived module path namespace differs.
      SPEC §4.2 and §4.8 make derived component names load-bearing for identity, scoped CSS, fragments, and graph facts; duplicate registry keys are ambiguous.
      Effective name: component-name-bad/cart-badge
      First definition: CartBadge
      Duplicate definition: Cart_Badge
      SPEC §6.1.1 package prefixes remain the cross-package namespace mechanism; app-authored/vendored components in one module must not share an effective wire name.",
          "length": 10,
          "message": "Duplicate component effective wire name. component-name-bad/cart-badge is used by CartBadge and Cart_Badge.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 6,
          },
        },
        {
          "code": "KV238",
          "fileName": "fragment-target-name-bad.tsx",
          "help": "Would lower to: one derived fragment-target registry key that maps to exactly one component render entry.
      Blocked reason: duplicate fragment-target wire names make enhanced fragment patch routing ambiguous.
      Fixes: rename the exported component binding, add stable authored key identity for repeated instances, move one component so its derived module path namespace differs, or set disableServerRefresh: true on the query-backed component that should not receive enhanced patches.
      SPEC §4.5, §4.8, and §6.2 make fragment-target names derived registry-visible identities; duplicate keys make enhanced fragment patches ambiguous.
      Fragment target: fragment-target-name-bad/product-grid
      First writer: ProductGrid
      Duplicate writer: Product_Grid
      Would emit registry:
      interface FragmentTargets {
        'fragment-target-name-bad/product-grid': ...;
      }",
          "length": 12,
          "message": "Duplicate fragment-target wire name. fragment-target-name-bad/product-grid is used by ProductGrid and Product_Grid.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 7,
          },
        },
        {
          "code": "KV242",
          "fileName": "form-fields-bad.tsx",
          "help": "Would lower to: an enhanced mutation form whose successful control names exactly match the bound mutation input schema.
      Blocked reason: form field names are part of the mutation input contract; unknown or missing names would only fail after submit.
      Fixes: rename the control, add the missing required control, or change the mutation input schema so the field set matches the form.
      SPEC §6.2 and §6.3 require form control names to be statically checked against the bound mutation input schema.",
          "length": 14,
          "message": "Enhanced mutation form fields do not match mutation input schema. unknown field "product" for mutation "cart/add". Expected fields: productId",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 12,
          },
        },
        {
          "code": "KV243",
          "fileName": "stream-target-bad.tsx",
          "help": "Would lower to: data-stream-text="source:id" on a declared text source element and kovo-text target="source:id" chunks.
      Blocked reason: streaming text targets are framework-owned source IDs, not arbitrary selectors or ambiguous DOM queries.
      Fixes: use streamText="source:id" with a literal namespace and stable id, or remove the streaming text target.
      SPEC §9.1 scopes <kovo-text> to compiler/runtime-declared data-stream-text targets and forbids arbitrary selector targeting.",
          "length": 21,
          "message": "Invalid stream text target. "#message" is not a stream source id; expected "source:id", not a selector or unscoped id.",
          "severity": "error",
          "start": {
            "column": 20,
            "line": 3,
          },
        },
        {
          "code": "KV239",
          "fileName": "view-transition-bad.tsx",
          "help": "Would lower to: static view-transition-name values that uniquely pair old and new DOM elements.
      Blocked reason: duplicate static transition names leave the browser and compiler without one canonical element pair.
      Fixes: give one static viewTransitionName a distinct value, or make the transition name dynamic only when page composition proves uniqueness.
      SPEC §8 uses view-transition-name as a cross-document element-pair identity; duplicate static names in one rendered module or supplied registry facts are ambiguous.
      View-transition name: product-hero
      First writer: ViewTransitionBad <img>
      Duplicate writer: ViewTransitionBad <img>
      Would emit registry:
      interface ViewTransitions {
        'product-hero': unknown;
      }
      Scope: module-local static rendered source plus registryFacts.viewTransitions when supplied; dynamic names require page-composition proof outside this validator.",
          "length": 33,
          "message": "Duplicate static view-transition name. product-hero is used by ViewTransitionBad <img> and ViewTransitionBad <img>.",
          "severity": "error",
          "start": {
            "column": 12,
            "line": 6,
          },
        },
        {
          "code": "KV240",
          "fileName": "query-shapes-bad.tsx",
          "help": "Would lower to: one query-shape fact per query name for server render, client updates, and binding validation.
      Blocked reason: duplicate query-shape facts would make graph indexing silently choose one shape for all generated bindings.
      Fixes: emit exactly one query-shape fact per query name, or rename one query so generated binding metadata has a single source of truth.
      SPEC §4.8 query binding validation depends on one stable shape per query; duplicate facts would otherwise silently last-write-wins during graph indexing.",
          "length": null,
          "message": "Duplicate query-shape fact for one query name. query="cart" sources=generated/queries/cart-refresh.shape.ts, generated/queries/cart.shape.ts",
          "severity": "error",
          "start": null,
        },
        {
          "code": "KV241",
          "fileName": "components/cart/badge.tsx",
          "help": "Blocked reason: derived component registry keys are deploy-load-bearing; changing one can strand in-flight documents whose morph identity still names the prior emitted component.
      Fixes: keep the component binding and module path stable across deploys, or review the rename/move as an intentional identity migration and refresh the previous registry facts.
      SPEC §4.2 and §4.8 make derived component names load-bearing for kovo-c identity, scoped CSS, fragments, and graph facts.
      Previous registry key: components/old-cart/cart-badge
      Current registry key: components/cart/badge/cart-badge
      DOM leaf: cart-badge
      Registry writer: previousRegistryFacts.components",
          "length": 9,
          "message": "Derived component registry key changed since the previous emitted graph. components/old-cart/cart-badge -> components/cart/badge/cart-badge.",
          "severity": "warn",
          "start": {
            "column": 14,
            "line": 2,
          },
        },
        {
          "code": "KV301",
          "fileName": "state-ownership-bad.tsx",
          "help": "Blocked reason: server/query facts stored in island-local state create a second client-owned copy of server truth.
      Fixes: keep the value in query data, derive UI-only state from client intent, or store only local presentation state.
      SPEC §4.1 keeps query data server-owned and local state private/client-owned.",
          "length": 10,
          "message": "Server fact stored in island-local state.",
          "severity": "lint",
          "start": {
            "column": 26,
            "line": 4,
          },
        },
        {
          "code": "KV302",
          "fileName": "binding-shape-bad.tsx",
          "help": "Would lower to: a data-bind path that the server renderer and loader can both read from the declared query/state shape.
      Blocked reason: the path is absent from the declared shape, so a server render or client update would read undefined.
      Fixes: correct the binding path, update the query projection/schema, or extract a named derive with declared inputs.
      SPEC §4.8 and §6.2 require bindings to type-check against query shapes.",
          "length": 22,
          "message": "data-bind path is not present in the declared query shape. cart.total",
          "severity": "error",
          "start": {
            "column": 23,
            "line": 3,
          },
        },
        {
          "code": "KV303",
          "fileName": "fragment-input-bad.tsx",
          "help": "Would lower to: a fragment target that can be re-rendered from declared query data plus stamped props.
      Blocked reason: the render input is outside those channels, so a fragment response could not reconstruct the subtree.
      Fixes: declare the value as query data, stamp it as a serializable prop, or move the dependency inside the fragment target.
      SPEC §4.5 requires fragment targets to be reconstructible from declared server inputs.",
          "length": 9,
          "message": "Fragment target render input is not declared as query data or stamped props. priceList",
          "severity": "error",
          "start": {
            "column": 20,
            "line": 5,
          },
        },
        {
          "code": "KV304",
          "fileName": "reserved-query-bad.tsx",
          "help": "Blocked reason: the query name collides with a reserved binding root such as state.
      Fixes: rename the query instance to an app-owned root and update its bindings.
      SPEC §4.8 reserves binding roots so query paths and island-local state paths stay unambiguous.",
          "length": null,
          "message": "Reserved query name is not allowed. state",
          "severity": "error",
          "start": null,
        },
        {
          "code": "KV311",
          "fileName": "coverage-bad.tsx",
          "help": "Coverage classification: CoverageBad expression UNHANDLED
      Blocked update: query expression has no data-bind, renderOnce, fragment, or isomorphic status
      Would lower to: a data-bind/update plan, inferred query-backed fragment target, isomorphic component, or renderOnce marker for the rendered position.
      Blocked reason: the query/state expression is outside the current §4.8 update-plan grammar and is not inside an inferred server-refresh target.
      Fixes: add a data-bind/query update plan, extract a derive/stamp, keep the component query-backed for inferred fragment refresh, mark it isomorphic, declare renderOnce, or set disableServerRefresh: true only when no enhanced refresh is intended.
      SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.",
          "length": 13,
          "message": "Query/state-dependent DOM position has no update status. CoverageBad cart.discount expression",
          "severity": "warn",
          "start": {
            "column": 44,
            "line": 5,
          },
        },
        {
          "code": "KV312",
          "fileName": "clock-render-bad.tsx",
          "help": "Would lower to: an explicit clocks input or query refresh cadence that re-runs the time-dependent rendered position.
      Blocked reason: the position reads wall-clock-sensitive data without a declared cadence, so rendered output can go stale without any modeled write.
      Fixes: declare a component clocks entry, add a query .refresh({ every | at | until }) binding modifier, or mark the clock renderOnce when freezing the value is intentional.
      SPEC §4.8 and §4.9 require every changing rendered fact, including time, to have declared update coverage.
      Escape: renderOnce is the documented suppression for intentionally immutable clock output.",
          "length": 7,
          "message": "Time-dependent rendered position lacks a declared cadence. now.ago",
          "severity": "error",
          "start": {
            "column": 46,
            "line": 3,
          },
        },
        {
          "code": "KV315",
          "fileName": "clock-derive-bad.tsx",
          "help": "Would lower to: a derive that re-runs from an explicit clocks input such as now.ago.
      Blocked reason: Date.now() and new Date() read the wall clock without a declared cadence, so the update plan can freeze time-derived UI.
      Fixes: declare a component clocks entry and pass now.<name> into the derive, or mark the clock renderOnce when freezing the value is intentional.
      SPEC §4.8 and §4.9 require derive inputs to name every fact that can change rendered output.
      Escape: renderOnce is the documented suppression for intentionally immutable clock output.",
          "length": 10,
          "message": "Untracked clock read in derive; use a declared clocks input. Date.now in ClockDeriveBad$label",
          "severity": "warn",
          "start": {
            "column": 64,
            "line": 2,
          },
        },
        {
          "code": "KV316",
          "fileName": "isomorphic-slot-bad.tsx",
          "help": "Would lower to: a client self-render that morphs only the island's own positions while leaving each projected-children/named-slot region (kovo-slot="children"/kovo-slot="<name>") in place as a morph-stable hole.
      Blocked reason: a client self-render has no slot/children arguments (projected content ships once in the initial HTML), so an isomorphic island that composes children or slots would re-render those regions as fresh Html and drift from the server output.
      Fixes: lift the dynamic part above or below the slot so the slot region stays a contiguous static hole, make the children a stamped-prop-hoistable inferred fragment target (§4.5/KV230), or drop isomorphic: true and use a server fragment.
      SPEC §4.5 and §4.8 require a children/slot-accepting isomorphic island to partition its render into self-render positions plus preserved projected-children regions.
      Escape: a server fragment (no isomorphic: true) re-renders the whole subtree including projected children with no self-render drift risk.",
          "length": 12,
          "message": "isomorphic: true on a children/slot-accepting component would drift on self-render. children",
          "severity": "error",
          "start": {
            "column": 30,
            "line": 6,
          },
        },
        {
          "code": "KV320",
          "fileName": "event-payload-bad.tsx",
          "help": "Blocked reason: a fire-and-forget event payload is carrying data that overlaps server-owned query facts.
      Fixes: send only client intent, use an optimistic transform for query data, or route the change through a mutation/domain write.
      SPEC §6.4 keeps cross-island events for intent, not as a shadow transport for server facts.",
          "length": 45,
          "message": "Event payload overlaps query data; use a transform. product.unitPrice",
          "severity": "lint",
          "start": {
            "column": 22,
            "line": 3,
          },
        },
        {
          "code": "KV330",
          "fileName": "mutation-surface-bad.ts",
          "help": "Blocked reason: direct request/db access in a mutation handler bypasses the domain write surface and weakens touch-graph analysis.
      Fixes: move writes behind a domain() module, inject the domain operation into the handler, or use the typed transaction context only inside the domain layer.
      SPEC §11.4 and §14 require writes to flow through domains so invalidation and verifier diagnostics stay complete.",
          "length": 10,
          "message": "Direct db access in a mutation handler; route through domain.",
          "severity": "lint",
          "start": {
            "column": 5,
            "line": 4,
          },
        },
        {
          "code": "KV420",
          "fileName": "stateful-fragment-bad.tsx",
          "help": "Would lower to: a full-subtree re-render from (declared queries ∪ stamped props) on every fragment patch of the enclosing server-refreshable target.
      Blocked reason: the fragment morph carries no serialization of island-local kovo-state (§9.1), so re-emitting the enclosing target would reset the nested island to its render-time default and clobber the child's live local state.
      Fixes: lift the child's state into a declared query so it travels in the refreshable channel, mark the child isomorphic: true so it self-renders rather than being server-refreshed (§4.8), set disableServerRefresh: true on the enclosing component so the child reclassifies under §4.9, or move the stateful island outside the refreshable target.
      SPEC §4.5/§4.9/§9.1 forbid an island declaring local state from rendering inside another component's inferred server-refreshable fragment target.
      Escape: document-lifetime-immutable local state is renderOnce and does not trip KV420.",
          "length": 7,
          "message": "Island with local state nested inside a server-refreshable fragment target loses its state on refresh. Stepper inside CartPanel.",
          "severity": "error",
          "start": {
            "column": 8,
            "line": 13,
          },
        },
        {
          "code": "KV421",
          "fileName": "app graph mutation table",
          "help": "Would lower to: one mutation fact per mutation key for the invalidation registry and server dispatch table.
      Blocked reason: two mutation declarations share one key, so graph indexing silently last-write-wins the invalidation set while server dispatch first-match-wins the handler — the two layers disagree, an invalidation can be computed for a mutation that never runs, and the wrong handler (with the wrong input schema and guards) executes against attacker-shaped input.
      Fixes: emit exactly one mutation fact per mutation key, or rename one mutation so its key is unique across the app graph.
      SPEC §6.1 makes the mutation registry key-addressed and §9.5 dispatches a POST to exactly one keyed handler; duplicate mutation keys would otherwise silently last-write-wins the invalidation registry while first-match-wins server dispatch — like routes (KV228), components (KV237), fragment targets (KV238), view transitions (KV239), and query shapes (KV240), mutation keys must be unique.",
          "length": null,
          "message": "Duplicate mutation key. mutation key "cart/add" appears 2 times in graph mutations.",
          "severity": "error",
          "start": null,
        },
        {
          "code": "KV435",
          "fileName": "query-wire-bad.tsx",
          "help": "Would lower to: a client-readable kovo-query payload embedded in the document and hydrated by the browser query store.
      Blocked reason: the projected query shape contains a secret-classified field, or an opaque/unresolved projection reads a table carrying secret columns, so rendering this query could serialize confidential data onto the client wire.
      Fixes: remove the secret field or opaque projection, select explicit non-secret columns, select a non-secret surrogate, or add an explicit reveal/redaction escape once the audited reveal surface lands.
      SPEC §6.2, §10.2, and §11.3 make query results JsonValue-bounded client wire values; a secret-classified or unprovable secret-table projection is ineligible for that boundary.",
          "length": null,
          "message": "Secret query value reaches the client wire. query="user" path="user.passwordHash"",
          "severity": "error",
          "start": null,
        },
        {
          "code": "KV437",
          "fileName": "client-capture-bad.tsx",
          "help": "Would lower to: a client handler module whose captured cross-module imports all resolve to serializable literals or whitelisted client symbols.
      Blocked reason: a client handler closure that captures a server-only binding (a secret/process.env-derived value, or any cross-module import not provably client-safe) re-emits it verbatim into the client bundle, leaking confidential server state to the browser.
      Fixes: do not capture the server value in client code; pass a server-computed safe value as a prop, or use publishToClient(value, { reason }) as the audited escape, surfaced in kovo explain --capabilities.
      SPEC §6.6/§6.2 and secure-framework Phase 4/Tier 0: the emit filter is fail-closed whole-channel (a narrow process.env/brand-only gate is unsound — call-wrapped secrets escape).",
          "length": 17,
          "message": "Server-only value captured into a client handler reaches the client bundle. import="STRIPE_SECRET_KEY" from="./secrets" form=named",
          "severity": "error",
          "start": {
            "column": 40,
            "line": 7,
          },
        },
      ]
    `);
  });

  it('keeps KV201 and KV230 teaching diagnostics compatibility-visible', () => {
    const compatibilityFacts = compilerOwnedDiagnosticMatrix
      .filter((row) => row.code === 'KV201' || row.code === 'KV230')
      .map((row) => snapshotDiagnostic(representativeDiagnostic(row.code, row.negative())));

    expect(compatibilityFacts).toMatchInlineSnapshot(`
      [
        {
          "code": "KV201",
          "fileName": "handler-captures-bad.tsx",
          "help": "Would lower to: on:click="/c/__v/<version>/handler-captures-bad.client.js#HandlerCapturesBad$button_click"
      Blocked expression: () => window.alert("x")
      Element params: -
      Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.
      Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.
      Blocked reason: captured runtime values cannot be serialized into the generated handler module boundary.
      SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.",
          "length": 8,
          "message": "Closure captures unserializable value.",
          "severity": "error",
          "start": {
            "column": 9,
            "line": 1,
          },
        },
        {
          "code": "KV230",
          "fileName": "fragment-children-bad.tsx",
          "help": "Would hoist children to: CartRow$slot_children
      Blocked children: <span>{escapeText(snapshot.total)}</span>
      Blocked reason: fragment responses must fully describe the DOM they produce, but these children cannot be hoisted through serializable props.
      Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.
      SPEC §4.5 requires fragment-target children to lower to component references when they cross the target boundary.",
          "length": 41,
          "message": "Fragment-target children cannot lower to a component reference. CartRow",
          "severity": "error",
          "start": {
            "column": 11,
            "line": 19,
          },
        },
      ]
    `);
  });
});

function matrixCodes(): DiagnosticCode[] {
  return compilerOwnedDiagnosticMatrix.map((row) => row.code).sort();
}

function outOfScopeCodeSet(): Set<DiagnosticCode> {
  return new Set(outOfScopeCompilerDiagnostics.map((row) => row.code));
}

function allCompilerOwnedDiagnosticCodes(): DiagnosticCode[] {
  return [
    ...(Object.keys(diagnosticDefinitions).filter(isCompilerOwnedKv2xxKv3xxCode) as DiagnosticCode[]),
    'KV420',
    'KV421',
    'KV422',
    'KV423',
    'KV424',
    'KV425',
    'KV426',
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
    'KV438',
  ].sort();
}

function isCompilerOwnedKv2xxKv3xxCode(code: string): boolean {
  return /^KV[23]\d{2}$/.test(code);
}

function representativeDiagnostic(
  code: DiagnosticCode,
  diagnostics: readonly CompilerDiagnostic[],
): CompilerDiagnostic {
  const diagnostic = diagnostics.find((candidate) => candidate.code === code);
  if (!diagnostic) throw new Error(`Expected ${code} diagnostic in representative fixture.`);
  return diagnostic;
}

function snapshotDiagnostic(diagnostic: CompilerDiagnostic): DiagnosticSnapshotFact {
  return {
    code: diagnostic.code,
    fileName: diagnostic.fileName,
    help: diagnostic.help ? normalizeDiagnosticText(diagnostic.help) : null,
    length: diagnostic.length ?? null,
    message: normalizeDiagnosticText(diagnostic.message),
    severity: diagnostic.severity,
    start: diagnostic.start ?? null,
  };
}

function normalizeDiagnosticText(text: string): string {
  return text.replaceAll(/\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\//g, '/c/__v/<version>/');
}
