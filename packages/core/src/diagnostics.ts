/** Severity tier of a diagnostic, from blocking `error` down to advisory `notice`. */
export type DiagnosticSeverity = 'error' | 'warn' | 'lint' | 'notice';

/** The string-literal union of every `KV###` diagnostic code the framework can emit. */
export type DiagnosticCode =
  | 'KV201'
  | 'KV210'
  | 'KV211'
  | 'KV212'
  | 'KV220'
  | 'KV221'
  | 'KV222'
  | 'KV223'
  | 'KV224'
  | 'KV225'
  | 'KV226'
  | 'KV227'
  | 'KV228'
  | 'KV230'
  | 'KV231'
  | 'KV232'
  | 'KV233'
  | 'KV234'
  | 'KV235'
  | 'KV236'
  | 'KV237'
  | 'KV238'
  | 'KV239'
  | 'KV240'
  | 'KV241'
  | 'KV242'
  | 'KV243'
  | 'KV301'
  | 'KV302'
  | 'KV303'
  | 'KV304'
  | 'KV310'
  | 'KV311'
  | 'KV312'
  | 'KV314'
  | 'KV315'
  | 'KV320'
  | 'KV330'
  | 'KV402'
  | 'KV403'
  | 'KV404'
  | 'KV405'
  | 'KV406'
  | 'KV407'
  | 'KV408'
  | 'KV409'
  | 'KV410'
  | 'KV411'
  | 'KV412'
  | 'KV413';

/** A diagnostic's registry entry: its code, severity, message, optional help, and detail labels. */
export interface DiagnosticDefinition {
  code: DiagnosticCode;
  detailLabels?: Readonly<Record<string, string>>;
  help?: string;
  severity: DiagnosticSeverity;
  message: string;
}

/**
 * Registry-side classification of the teaching fields each compiler diagnostic must expose.
 * SPEC §5.2 hard rule 5 requires diagnostics to explain the lowering, why it cannot proceed,
 * concrete fixes, and escape posture where the framework has one.
 */
export interface DiagnosticTeachingSchema {
  blockedReason: boolean;
  escapePosture: 'documented' | 'none';
  loweredForm: 'required' | 'not-applicable';
}

/** Options controlling how `diagnosticDefinitionText` includes or prefers help text. */
export interface DiagnosticTextOptions {
  includeHelp?: boolean;
  preferHelp?: boolean;
}

/**
 * Render the human-readable text for a diagnostic code, optionally including or
 * preferring its help line.
 *
 * @param code - A `KV###` diagnostic code.
 * @param options - Whether to include/prefer the help text.
 * @returns The diagnostic's message (and help, when requested).
 * @example
 * import { diagnosticDefinitionText } from '@kovojs/core/internal/diagnostics';
 *
 * const text: string = diagnosticDefinitionText('KV201', { includeHelp: true });
 */
export function diagnosticDefinitionText(
  code: DiagnosticCode,
  options: DiagnosticTextOptions = {},
): string {
  const definition = diagnosticDefinitions[code];
  const help = 'help' in definition ? definition.help : undefined;
  const message = options.preferHelp ? (help ?? definition.message) : definition.message;
  if (!options.includeHelp || !help || message === help) return message;

  return `${message} ${help}`;
}

/**
 * Type guard: narrow an unknown value to a known `KV###` diagnostic code.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a registered `DiagnosticCode`.
 * @example
 * import { isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
 *
 * const code: unknown = 'KV201';
 * if (isDiagnosticCode(code)) {
 *   // code is now typed as DiagnosticCode
 * }
 */
export function isDiagnosticCode(value: unknown): value is DiagnosticCode {
  return typeof value === 'string' && value in diagnosticDefinitions;
}

/** Compiler-owned diagnostics whose help must satisfy SPEC §5.2 teaching-error shape. */
export const compilerDiagnosticTeachingSchemas = {
  KV201: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV210: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV211: { blockedReason: true, escapePosture: 'documented', loweredForm: 'not-applicable' },
  KV212: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV220: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV221: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV222: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV223: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV224: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV225: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV226: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV227: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV228: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV230: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV231: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV232: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV233: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV234: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV235: { blockedReason: true, escapePosture: 'documented', loweredForm: 'not-applicable' },
  KV236: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV237: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV238: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV239: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV240: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV241: { blockedReason: true, escapePosture: 'documented', loweredForm: 'not-applicable' },
  KV242: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV243: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV301: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV302: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV303: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV304: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV310: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV311: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV312: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV314: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV315: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV320: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV330: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
} as const satisfies Partial<Record<DiagnosticCode, DiagnosticTeachingSchema>>;

/** The frozen registry of every `KV###` diagnostic: code → definition (message, severity, help). */
export const diagnosticDefinitions = {
  KV201: {
    code: 'KV201',
    detailLabels: {
      blockedExpression: 'Blocked expression:',
      elementParams: 'Element params:',
      handlerLowering: 'Would lower to:',
    },
    help: [
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
      'Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.',
      'Blocked reason: captured runtime values cannot be serialized into the generated handler module boundary.',
      'SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.',
    ].join('\n'),
    severity: 'error',
    message: 'Closure captures unserializable value.',
  },
  KV210: {
    code: 'KV210',
    help: [
      'Would lower to: a generated Component$element_event handler export with a stable source-derived URL.',
      'Blocked reason: anonymous handler identity is less stable for generated artifacts, explanations, and agent repairs.',
      'Fixes: extract a named function in module scope or reference a named local handler from the JSX event.',
      'SPEC §5.2 requires readable, source-derived emitted names; this lint is advisory and has no suppression beyond accepting the generated fallback name.',
    ].join('\n'),
    severity: 'lint',
    message: 'Anonymous handler; name it for stable identity.',
  },
  KV211: {
    code: 'KV211',
    help: [
      'Blocked reason: on:load runs at parse time and adds eager JavaScript to the page budget.',
      'Fixes: use a user/event trigger instead, or attach an adjacent KV211 justification comment when parse-time execution is intentional.',
      'SPEC §4.7 keeps on:load grep-visible as the eager-JS escape hatch.',
      'Escape: an attached KV211 justification comment preserves the lint trail without blocking compilation.',
    ].join('\n'),
    severity: 'lint',
    message: 'on:load eager trigger requires a justification comment.',
  },
  KV212: {
    code: 'KV212',
    help: [
      'Blocked reason: unknown on:* triggers cannot be mapped to the closed event/trigger vocabulary the loader understands.',
      "Fixes: use a DOM event name, use one of Kovo's declared execution triggers, or move the behavior into a component primitive that owns the attribute.",
      'SPEC §4.7 requires declared execution so generated artifacts remain auditable.',
    ].join('\n'),
    severity: 'lint',
    message: 'Unknown on:* event or execution trigger name.',
  },
  KV220: {
    code: 'KV220',
    help: [
      'Would lower to: a route-checked href/action that participates in the typed route registry.',
      'Blocked reason: the literal target does not match any declared canonical route path.',
      'Fixes: use a typed route helper, declare the route, correct the literal path, or mark an intentional full-origin/external navigation with the external escape hatch.',
      'SPEC §6.4 and §9.5 require navigation targets to stay type-checked against the route table.',
      'Escape: external/full-origin URLs opt out because they are outside the app route graph.',
    ].join('\n'),
    severity: 'error',
    message: 'Literal href or form action matches no declared route.',
  },
  KV221: {
    code: 'KV221',
    help: [
      'Would lower to: light-DOM IDREF wiring whose target id exists in the same component scope.',
      'Blocked reason: the referenced id is absent, outside the validated scope, or hidden behind a different component boundary.',
      'Fixes: add the target id in this component scope, pass a generated id through props, or correct the IDREF attribute value.',
      'SPEC §4.5 and §6.4 require IDREFs such as commandfor, popovertarget, for, and aria-* to resolve at compile time.',
    ].join('\n'),
    severity: 'error',
    message: 'IDREF references an id not present in component scope.',
  },
  KV222: {
    code: 'KV222',
    help: [
      'Would lower to: the compiler-derived data-bind stamp for the typed JSX expression.',
      'Blocked reason: a hand-written stamp names a different path than the expression it wraps, so server render and client update semantics could drift.',
      'Fixes: remove the hand-written stamp and let the compiler derive it, or make the stamp path exactly match the typed expression.',
      'SPEC §4.8 treats typed expressions and binding stamps as one fact and rejects drift.',
    ].join('\n'),
    severity: 'error',
    message: 'Hand-written binding stamp disagrees with the typed expression it wraps.',
  },
  KV223: {
    code: 'KV223',
    help: [
      'Would lower to: the same data-bind stamp the author already wrote by hand.',
      'Blocked reason: the stamp is redundant in app-authored TSX because the compiler can derive it from the typed expression.',
      'Fixes: remove the hand-written data-bind stamp and keep the typed JSX expression as the source of truth.',
      'SPEC §4.8 permits residual stamps for emitted IR fixpoint validation, but app TSX should not hand-author derivable stamps.',
      'Escape: emitted compiler artifacts may retain residual stamps for fixpoint checks; app source should use TSX sugar.',
    ].join('\n'),
    severity: 'lint',
    message: 'Redundant hand-written binding stamp in sugar; the compiler derives it.',
  },
  KV224: {
    code: 'KV224',
    help: [
      'Blocked reason: duplicate static ids make IDREF proofs ambiguous, and static ids inside repeatable stamps can produce multiple elements with the same id.',
      'Fixes: generate ids from props/kovo-key, move the id outside the repeatable subtree, or pass a unique id down to the component.',
      'SPEC §4.5 requires ids to be unique by construction so KV221 IDREF validation remains meaningful.',
    ].join('\n'),
    severity: 'error',
    message: 'Static id is duplicated in component scope or appears inside a repeatable stamp.',
  },
  KV225: {
    code: 'KV225',
    help: [
      'Would lower to: HTML whose parsed DOM preserves the authored JSX tree.',
      'Blocked reason: the HTML parser would re-parent or drop invalid children, changing morph identity and fragment targets after serving.',
      'Fixes: use content-model-valid wrapper elements, move table rows into table/section parents, or split paragraph/block content into valid siblings.',
      'SPEC §4.2 requires compiler-served HTML and parsed DOM shape to agree.',
    ].join('\n'),
    severity: 'error',
    message: 'JSX nesting violates the HTML content model.',
  },
  KV226: {
    code: 'KV226',
    help: [
      'Would lower to: emitted IR stamps whose kovo-c and kovo-deps names resolve to known components and query instances.',
      'Blocked reason: residual compiler stamps reference a component or query that is not present in the module/registry facts.',
      'Fixes: recompile from TSX source, correct the generated stamp, or add the missing component/query fact to the compile graph.',
      'SPEC §5.2 allows lowered IR only as compiler output/fixpoint input, and fixpoint validation must reject stale names.',
    ].join('\n'),
    severity: 'error',
    message: 'kovo-deps or kovo-c names an unknown query instance or component.',
  },
  KV227: {
    code: 'KV227',
    help: [
      'Blocked reason: the binding path crosses a nullable query segment without declaring empty-on-null behavior.',
      'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
      'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
    ].join('\n'),
    severity: 'error',
    message: 'Binding path traverses a nullable segment without ?.',
  },
  KV228: {
    code: 'KV228',
    help: [
      'Blocked reason: static-first route matching cannot choose a single canonical handler for at least one request path.',
      'Fixes: remove duplicate route facts, split overlapping patterns, add a static segment, or make one route path more specific.',
      'SPEC §9.5 requires route matching to be unambiguous at compile time.',
    ].join('\n'),
    severity: 'error',
    message:
      'Ambiguous route table: two routes can match the same canonical request path or duplicate route path.',
  },
  KV230: {
    code: 'KV230',
    detailLabels: {
      blockedChildren: 'Blocked children:',
      slotHoist: 'Would hoist children to:',
    },
    help: [
      'Blocked reason: fragment responses must fully describe the DOM they produce, but these children cannot be hoisted through serializable props.',
      'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
      'SPEC §4.5 requires fragment-target children to lower to component references when they cross the target boundary.',
    ].join('\n'),
    severity: 'error',
    message: 'Fragment-target children cannot lower to a component reference.',
  },
  KV231: {
    code: 'KV231',
    help: [
      'Would lower to: a single composed attribute set for primitive composition.',
      'Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.',
      'Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.',
      'SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.',
    ].join('\n'),
    severity: 'error',
    message: 'Unmergeable attribute conflict in primitive composition.',
  },
  KV232: {
    code: 'KV232',
    help: [
      'Would lower to: author-visible override of a primitive-owned ARIA, role, or state attribute.',
      'Blocked reason: the override is allowed but can change accessibility semantics or be clobbered by runtime-updated primitive state.',
      'Fixes: prefer the primitive API, remove the override, or keep it intentionally and audit the generated merge explanation.',
      'SPEC §4.6 keeps this override as a lint-level escape hatch so author intent stays visible.',
      'Escape: compilation continues; the lint documents the override for review.',
    ].join('\n'),
    severity: 'lint',
    message: 'Author overrides a primitive-owned ARIA or state attribute.',
  },
  KV233: {
    code: 'KV233',
    help: [
      'Would lower to: exactly one writer for each data-bind target slot.',
      'Blocked reason: multiple bindings target the same text/attribute slot, so the client loader cannot choose a single update source.',
      'Fixes: keep one binding, split values across distinct elements/attributes, or combine the values in a named derive before binding.',
      'SPEC §4.6 and §4.8 require binding slots to have a single writer.',
    ].join('\n'),
    severity: 'error',
    message: 'Two writers target the same binding slot.',
  },
  KV234: {
    code: 'KV234',
    help: [
      'Would lower to: package-scoped component names, CSS scopes, and behavior attributes using one effective prefix.',
      'Blocked reason: the prefix is missing, invalid, duplicated, or reserves kovo-* outside @kovojs/* packages.',
      'Fixes: assign a lowercase dash-terminated unique prefix, alias one package, or use kovo-* only for framework packages.',
      'SPEC §6.1.1 requires app-wide unique package component prefixes.',
    ].join('\n'),
    severity: 'error',
    message: 'Package component prefix registration conflict or reservation violation.',
  },
  KV235: {
    code: 'KV235',
    help: [
      'Blocked reason: app source is hand-authoring lowered string/render IR instead of TSX.',
      'Fixes: write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.',
      'SPEC §5.2: TSX is the sole app-authoring surface.',
      'Escape: there is no v1 suppression or ejection workflow for hand-authored lowered IR.',
    ].join('\n'),
    severity: 'error',
    message:
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
  },
  KV236: {
    code: 'KV236',
    help: [
      'Blocked reason: the output context can execute script, navigate unexpectedly, inject unsafe CSS, or bypass normal JSX escaping.',
      'Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.',
      'SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.',
    ].join('\n'),
    severity: 'error',
    message: 'Unsafe output context requires an explicit trusted Kovo escape hatch.',
  },
  KV237: {
    code: 'KV237',
    help: [
      'Would lower to: one derived component registry key per component across the app graph.',
      'Blocked reason: duplicate derived registry keys make component identity, CSS scoping, fragment routing, and graph facts ambiguous.',
      'Fixes: rename the exported component binding, or move one component so its derived module path namespace differs.',
      'SPEC §4.2 and §4.8 make derived component names load-bearing for identity, scoped CSS, fragments, and graph facts; duplicate registry keys are ambiguous.',
    ].join('\n'),
    severity: 'error',
    message: 'Duplicate component effective wire name.',
  },
  KV238: {
    code: 'KV238',
    help: [
      'Would lower to: one derived fragment-target registry key that maps to exactly one component render entry.',
      'Blocked reason: duplicate fragment-target wire names make enhanced fragment patch routing ambiguous.',
      'Fixes: rename the exported component binding, add stable authored key identity for repeated instances, move one component so its derived module path namespace differs, or set disableServerRefresh: true on the query-backed component that should not receive enhanced patches.',
      'SPEC §4.5, §4.8, and §6.2 make fragment-target names derived registry-visible identities; duplicate keys make enhanced fragment patches ambiguous.',
    ].join('\n'),
    severity: 'error',
    message: 'Duplicate fragment-target wire name.',
  },
  KV239: {
    code: 'KV239',
    help: [
      'Would lower to: static view-transition-name values that uniquely pair old and new DOM elements.',
      'Blocked reason: duplicate static transition names leave the browser and compiler without one canonical element pair.',
      'Fixes: give one static viewTransitionName a distinct value, or make the transition name dynamic only when page composition proves uniqueness.',
      'SPEC §8 uses view-transition-name as a cross-document element-pair identity; duplicate static names in one rendered module or supplied registry facts are ambiguous.',
    ].join('\n'),
    severity: 'error',
    message: 'Duplicate static view-transition name.',
  },
  KV240: {
    code: 'KV240',
    help: [
      'Would lower to: one query-shape fact per query name for server render, client updates, and binding validation.',
      'Blocked reason: duplicate query-shape facts would make graph indexing silently choose one shape for all generated bindings.',
      'Fixes: emit exactly one query-shape fact per query name, or rename one query so generated binding metadata has a single source of truth.',
      'SPEC §4.8 query binding validation depends on one stable shape per query; duplicate facts would otherwise silently last-write-wins during graph indexing.',
    ].join('\n'),
    severity: 'error',
    message: 'Duplicate query-shape fact for one query name.',
  },
  KV241: {
    code: 'KV241',
    help: [
      'Blocked reason: derived component registry keys are deploy-load-bearing; changing one can strand in-flight documents whose morph identity still names the prior emitted component.',
      'Fixes: keep the component binding and module path stable across deploys, or review the rename/move as an intentional identity migration and refresh the previous registry facts.',
      'SPEC §4.2 and §4.8 make derived component names load-bearing for kovo-c identity, scoped CSS, fragments, and graph facts.',
    ].join('\n'),
    severity: 'warn',
    message: 'Derived component registry key changed since the previous emitted graph.',
  },
  KV242: {
    code: 'KV242',
    help: [
      'Would lower to: an enhanced mutation form whose successful control names exactly match the bound mutation input schema.',
      'Blocked reason: form field names are part of the mutation input contract; unknown or missing names would only fail after submit.',
      'Fixes: rename the control, add the missing required control, or change the mutation input schema so the field set matches the form.',
      'SPEC §6.2 and §6.3 require form control names to be statically checked against the bound mutation input schema.',
    ].join('\n'),
    severity: 'error',
    message: 'Enhanced mutation form fields do not match mutation input schema.',
  },
  KV243: {
    code: 'KV243',
    help: [
      'Would lower to: data-stream-text="source:id" on a declared text source element and kovo-text target="source:id" chunks.',
      'Blocked reason: streaming text targets are framework-owned source IDs, not arbitrary selectors or ambiguous DOM queries.',
      'Fixes: use streamText="source:id" with a literal namespace and stable id, or remove the streaming text target.',
      'SPEC §9.1 scopes <kovo-text> to compiler/runtime-declared data-stream-text targets and forbids arbitrary selector targeting.',
    ].join('\n'),
    severity: 'error',
    message: 'Invalid stream text target.',
  },
  KV301: {
    code: 'KV301',
    help: [
      'Blocked reason: server/query facts stored in island-local state create a second client-owned copy of server truth.',
      'Fixes: keep the value in query data, derive UI-only state from client intent, or store only local presentation state.',
      'SPEC §4.1 keeps query data server-owned and local state private/client-owned.',
    ].join('\n'),
    severity: 'lint',
    message: 'Server fact stored in island-local state.',
  },
  KV302: {
    code: 'KV302',
    help: [
      'Would lower to: a data-bind path that the server renderer and loader can both read from the declared query/state shape.',
      'Blocked reason: the path is absent from the declared shape, so a server render or client update would read undefined.',
      'Fixes: correct the binding path, update the query projection/schema, or extract a named derive with declared inputs.',
      'SPEC §4.8 and §6.2 require bindings to type-check against query shapes.',
    ].join('\n'),
    severity: 'error',
    message: 'data-bind path is not present in the declared query shape.',
  },
  KV303: {
    code: 'KV303',
    help: [
      'Would lower to: a fragment target that can be re-rendered from declared query data plus stamped props.',
      'Blocked reason: the render input is outside those channels, so a fragment response could not reconstruct the subtree.',
      'Fixes: declare the value as query data, stamp it as a serializable prop, or move the dependency inside the fragment target.',
      'SPEC §4.5 requires fragment targets to be reconstructible from declared server inputs.',
    ].join('\n'),
    severity: 'error',
    message: 'Fragment target render input is not declared as query data or stamped props.',
  },
  KV304: {
    code: 'KV304',
    help: [
      'Blocked reason: the query name collides with a reserved binding root such as state.',
      'Fixes: rename the query instance to an app-owned root and update its bindings.',
      'SPEC §4.8 reserves binding roots so query paths and island-local state paths stay unambiguous.',
    ].join('\n'),
    severity: 'error',
    message: 'Reserved query name is not allowed.',
  },
  KV310: {
    code: 'KV310',
    help: [
      'Would lower to: an optimistic status for each invalidated query edge, such as a transform or await-fragment decision.',
      'Blocked reason: a mutation invalidates a query without declaring how the UI should predict or defer that update.',
      'Fixes: add an optimistic transform, declare await-fragment, or narrow the invalidation so the query is not touched.',
      'SPEC §11.4 requires mutation writes, query invalidations, and optimistic coverage to be checked edge by edge.',
    ].join('\n'),
    severity: 'warn',
    message: 'Invalidated query lacks optimistic transform.',
  },
  KV311: {
    code: 'KV311',
    help: [
      'Would lower to: a data-bind/update plan, fragment boundary, isomorphic component, or renderOnce marker for the rendered position.',
      'Blocked reason: the compiler found a query/state-dependent DOM position without an update strategy.',
      'Fixes: add a data-bind/query update plan, mark the expression renderOnce, move the subtree behind a fragment target, or make the component isomorphic.',
      'SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.',
    ].join('\n'),
    severity: 'warn',
    message: 'Query/state-dependent DOM position has no update status.',
  },
  KV312: {
    code: 'KV312',
    help: [
      'Would lower to: an explicit clocks input or query refresh cadence that re-runs the time-dependent rendered position.',
      'Blocked reason: the position reads wall-clock-sensitive data without a declared cadence, so rendered output can go stale without any modeled write.',
      'Fixes: declare a component clocks entry, add a query .refresh({ every | at | until }) binding modifier, or mark the clock renderOnce when freezing the value is intentional.',
      'SPEC §4.8 and §4.9 require every changing rendered fact, including time, to have declared update coverage.',
      'Escape: renderOnce is the documented suppression for intentionally immutable clock output.',
    ].join('\n'),
    severity: 'error',
    message: 'Time-dependent rendered position lacks a declared cadence.',
  },
  KV314: {
    code: 'KV314',
    help: [
      'Would lower to: immutable render output that never receives query update plans or fragment refresh.',
      'Blocked reason: a modeled write invalidates the query read by this renderOnce position, so the immutable declaration would hide stale UI.',
      'Fixes: remove renderOnce, add a data-bind/query update plan, move the position behind a fragment target, or narrow the write invalidation set.',
      'SPEC §4.9 requires write -> invalidated query -> rendered position coverage to be checked edge by edge.',
    ].join('\n'),
    severity: 'error',
    message: 'renderOnce position reads a query invalidated by a modeled write.',
  },
  KV315: {
    code: 'KV315',
    help: [
      'Would lower to: a derive that re-runs from an explicit clocks input such as now.ago.',
      'Blocked reason: Date.now() and new Date() read the wall clock without a declared cadence, so the update plan can freeze time-derived UI.',
      'Fixes: declare a component clocks entry and pass now.<name> into the derive, or mark the clock renderOnce when freezing the value is intentional.',
      'SPEC §4.8 and §4.9 require derive inputs to name every fact that can change rendered output.',
      'Escape: renderOnce is the documented suppression for intentionally immutable clock output.',
    ].join('\n'),
    severity: 'warn',
    message: 'Untracked clock read in derive; use a declared clocks input.',
  },
  KV320: {
    code: 'KV320',
    help: [
      'Blocked reason: a fire-and-forget event payload is carrying data that overlaps server-owned query facts.',
      'Fixes: send only client intent, use an optimistic transform for query data, or route the change through a mutation/domain write.',
      'SPEC §6.4 keeps cross-island events for intent, not as a shadow transport for server facts.',
    ].join('\n'),
    severity: 'lint',
    message: 'Event payload overlaps query data; use a transform.',
  },
  KV330: {
    code: 'KV330',
    help: [
      'Blocked reason: direct request/db access in a mutation handler bypasses the domain write surface and weakens touch-graph analysis.',
      'Fixes: move writes behind a domain() module, inject the domain operation into the handler, or use the typed transaction context only inside the domain layer.',
      'SPEC §11.4 and §14 require writes to flow through domains so invalidation and verifier diagnostics stay complete.',
    ].join('\n'),
    severity: 'lint',
    message: 'Direct db access in a mutation handler; route through domain.',
  },
  KV402: {
    code: 'KV402',
    severity: 'error',
    message: 'Write touched an undeclared domain.',
  },
  KV403: {
    code: 'KV403',
    severity: 'warn',
    message: 'Declared domain was never observed written.',
  },
  KV404: {
    code: 'KV404',
    severity: 'error',
    message: 'Write to unmapped table.',
  },
  KV405: {
    code: 'KV405',
    severity: 'warn',
    message: 'Conditional write branch was never executed under instrumentation.',
  },
  KV406: {
    code: 'KV406',
    severity: 'warn',
    message: 'Statically un-analyzable write site; manual touches required.',
  },
  KV407: {
    code: 'KV407',
    help: 'No mutation touch graph writes that domain.',
    severity: 'error',
    message: 'Query read from undeclared domain.',
  },
  KV408: {
    code: 'KV408',
    severity: 'error',
    message: 'Declared row key differs from observed row predicate.',
  },
  KV409: {
    code: 'KV409',
    severity: 'notice',
    message: 'Non-eq predicate degraded to table-level invalidation.',
  },
  KV410: {
    code: 'KV410',
    help: 'Opaque query projection requires a declared output schema.',
    severity: 'error',
    message: 'Query result shape failed declared output schema.',
  },
  KV411: {
    code: 'KV411',
    severity: 'error',
    message: 'Query read set includes an exempt table.',
  },
  KV412: {
    code: 'KV412',
    severity: 'error',
    message: 'Query reads an unmodeled relation.',
  },
  KV413: {
    code: 'KV413',
    help: [
      'Would lower to: an explicit DB-engine fan-out edge that unions trigger-written domains into the mutation touch graph.',
      'Blocked reason: a detected database trigger can mutate data outside the static Drizzle write chain, so invalidation would miss the affected domain.',
      'Fixes: declare kovo({ fans: [{ via, domain, when }] }) for the trigger fan-out, move the side-effect into a modeled domain write, or mark the table exempt only when no UI reads it.',
      'SPEC §10.1 and §11.1 require DB-engine side effects that cannot be derived statically to be declared and checked.',
    ].join('\n'),
    severity: 'error',
    message: 'Database engine side-effect needs a declared fan-out.',
  },
} as const satisfies Record<DiagnosticCode, DiagnosticDefinition>;
