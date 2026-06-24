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
  | 'KV244'
  | 'KV301'
  | 'KV302'
  | 'KV303'
  | 'KV304'
  | 'KV310'
  | 'KV311'
  | 'KV312'
  | 'KV314'
  | 'KV315'
  | 'KV316'
  | 'KV317'
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
  | 'KV413'
  | 'KV414'
  | 'KV415'
  | 'KV416'
  | 'KV417'
  | 'KV418'
  | 'KV419'
  | 'KV420'
  | 'KV421'
  | 'KV422'
  | 'KV423'
  | 'KV424'
  | 'KV425'
  | 'KV426'
  | 'KV431'
  | 'KV435'
  | 'KV436'
  | 'KV437';

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
  return typeof value === 'string' && Object.hasOwn(diagnosticDefinitions, value);
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
  KV244: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV301: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV302: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV303: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV304: { blockedReason: true, escapePosture: 'none', loweredForm: 'not-applicable' },
  KV310: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV311: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV312: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV314: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
  KV315: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV316: { blockedReason: true, escapePosture: 'documented', loweredForm: 'required' },
  KV317: { blockedReason: true, escapePosture: 'none', loweredForm: 'required' },
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
  KV244: {
    code: 'KV244',
    help: [
      'Would lower to: <Defer target="..." fallback={...} render={...} /> emitting a framework-owned <kovo-defer> placeholder.',
      'Blocked reason: defer() is an internal string-composition helper; as a JSX child it bypasses JSX fallback escaping and can render framework markup as text.',
      'Fixes: import Defer from @kovojs/server and render <Defer ... /> with JSX fallback content, or keep raw HTML behind an explicit trustedHtml(...) boundary outside JSX child position.',
      'SPEC §8 makes Defer the public route-region deferral API and keeps raw string composition internal.',
      'Escape: trustedHtml(...) remains the explicit raw-HTML escape hatch, but app JSX children should use <Defer>.',
    ].join('\n'),
    severity: 'lint',
    message: 'defer() used as a JSX child; use <Defer> instead.',
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
  KV316: {
    code: 'KV316',
    help: [
      'Would lower to: a client self-render that morphs only the island\'s own positions while leaving each projected-children/named-slot region (kovo-slot="children"/kovo-slot="<name>") in place as a morph-stable hole.',
      'Blocked reason: a client self-render has no slot/children arguments (projected content ships once in the initial HTML), so an isomorphic island that composes children or slots would re-render those regions as fresh Html and drift from the server output.',
      'Fixes: lift the dynamic part above or below the slot so the slot region stays a contiguous static hole, make the children a stamped-prop-hoistable inferred fragment target (§4.5/KV230), or drop isomorphic: true and use a server fragment.',
      'SPEC §4.5 and §4.8 require a children/slot-accepting isomorphic island to partition its render into self-render positions plus preserved projected-children regions.',
      'Escape: a server fragment (no isomorphic: true) re-renders the whole subtree including projected children with no self-render drift risk.',
    ].join('\n'),
    severity: 'error',
    message: 'isomorphic: true on a children/slot-accepting component would drift on self-render.',
  },
  KV317: {
    code: 'KV317',
    help: [
      "Would lower to: a static state-bearing ARIA attribute whose author value contradicts the primitive's render-time state.",
      "Blocked reason: state aria-* (aria-expanded/selected/checked/pressed/current, state-driven aria-disabled) is primitive-wins; the primitive's runtime derive keeps writing it, so a static author value that disagrees with the render-time state is a frozen-vs-clobbered ambiguity the author cannot have meant — distinct from the visible-override lint KV232.",
      "Fixes: drop the contradicting static value (let the primitive own it) or set it to match the primitive's render-time state.",
      'SPEC §4.6 makes a contradicting static state aria-* an error (KV317), not the override lint (KV232).',
    ].join('\n'),
    severity: 'error',
    message: "Static state-bearing aria-* value contradicts the primitive's render-time state.",
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
    // SPEC §11.2/§11.3: an unexercised conditional write branch is no longer advisory — it is a
    // CI-gating error (the static touch set is unproven for that branch).
    severity: 'error',
    message: 'Conditional write branch was never executed under instrumentation.',
  },
  KV406: {
    code: 'KV406',
    // SPEC §11.2/§11.3: a statically un-analyzable write site is a build-failing error (not a warn) —
    // the analyzer cannot prove the touch set, so it must be annotated or the write made analyzable.
    severity: 'error',
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
  KV414: {
    code: 'KV414',
    help: [
      'Would lower to: an owner-scoped read/write whose key predicate is traceable to req.session or an owns() ownership guard.',
      "Blocked reason: this query or write reaches an owner-annotated table through a client-visible key that is not tied to the session principal, so one user could read or mutate another user's rows (IDOR).",
      'Fixes: scope the predicate by a session field (e.g. eq(table.id, req.session.userId)), add an owns() ownership guard, or record a public-read justification if the table is genuinely public.',
      'SPEC §10.1/§10.3/§11.2 make the --unscoped audit a blocking gate: owner-table access must be session-traceable or ownership-guarded.',
    ].join('\n'),
    severity: 'error',
    message: 'Owner-table access is not scoped to the session principal (IDOR).',
  },
  KV415: {
    code: 'KV415',
    help: [
      'Would lower to: a typed response header record that serializes only framework-allowed header names and cookie values produced by the typed cookie builder.',
      'Blocked reason: arbitrary header names/values can smuggle forbidden response metadata or split headers when they contain CR/LF/NUL/control characters.',
      'Fixes: use the typed response-header allowlist, route cookies through the typed cookie builder, or remove the forbidden header write.',
      'SPEC §9.1.1 keeps response headers in a typed channel so generated wire responses remain auditable.',
    ].join('\n'),
    severity: 'error',
    message: 'Response header channel contains a forbidden header name or unsafe header value.',
  },
  KV416: {
    code: 'KV416',
    help: [
      'Would lower to: a production delta payload whose render-plan token matches the full dev render contract and whose delta applies back to the same HTML.',
      'Blocked reason: production delta output or render-plan token monotonicity failed, so a stale tab could patch DOM produced by a different render contract.',
      'Fixes: include every query shape and the update-plan grammar version in the render-plan token, fix the delta encoder, or disable the production build until the corpus gate passes.',
      'SPEC §5.2.2 makes this a build-failing production render-equivalence gate.',
    ].join('\n'),
    severity: 'error',
    message: 'Prod render-equivalence gate failed.',
  },
  KV417: {
    code: 'KV417',
    help: [
      'Would lower to: a deploy-skew policy that retains prior immutable /c/__v/... modules and per-token /_q reads for at least 24 hours.',
      'Blocked reason: the configured serving layer cannot retain the previous render-plan contract long enough for stale documents to recover safely.',
      'Fixes: raise the deploy-skew retention window to at least 24 hours, configure immutable client-module retention, and keep prior-token query reads available for the window.',
      'SPEC §14 requires stale documents to fail loud or recover instead of silently merging cross-build data.',
    ].join('\n'),
    severity: 'error',
    message: 'Deploy-skew retention window is below the required floor.',
  },
  KV418: {
    code: 'KV418',
    help: [
      'Would lower to: a csrf-exempt endpoint that authenticates by a signature/verifier (e.g. a webhook), not by the session cookie.',
      'Blocked reason: this endpoint opts out of CSRF protection (csrf: false) yet depends on the session — it reads req.session or runs a session/cookie-derived guard (authed, role(), owns()). CSRF protection is exactly what keeps cookie-authenticated requests safe, so a session-dependent endpoint that disables it is forgeable.',
      'Fixes: keep CSRF protection (remove csrf: false) for any session-authenticated endpoint; or, if the endpoint is a genuine third-party callback, authenticate it by a signature verifier instead of the session and drop the session-derived guard.',
      'SPEC §9.1 makes a csrf: false endpoint that depends on the session a compile error.',
    ].join('\n'),
    severity: 'error',
    message: 'csrf-exempt endpoint depends on the session (forgeable).',
  },
  KV419: {
    code: 'KV419',
    help: [
      "Would lower to: a speculationrules prerender that renders this route server-side, with the user's credentials, on hover/pointerdown.",
      'Blocked reason: prefetch "moderate" prerenders a guarded (session-dependent) route, which executes its render — and any per-user side effects — for a navigation that may be discarded.',
      'Fixes: use prefetch "conservative" (prefetch document bytes, no prerender) or false; restrict prefetch "moderate" to public, idempotent routes; or remove the guard if the route is genuinely public.',
      'SPEC §8 requires auto-prerender to be opt-in only where renders are idempotent and not session-dependent.',
    ].join('\n'),
    severity: 'error',
    message: 'prefetch "moderate" prerenders a guarded, session-dependent route.',
  },
  KV420: {
    code: 'KV420',
    help: [
      'Would lower to: a full-subtree re-render from (declared queries ∪ stamped props) on every fragment patch of the enclosing server-refreshable target.',
      "Blocked reason: the fragment morph carries no serialization of island-local kovo-state (§9.1), so re-emitting the enclosing target would reset the nested island to its render-time default and clobber the child's live local state.",
      "Fixes: lift the child's state into a declared query so it travels in the refreshable channel, mark the child isomorphic: true so it self-renders rather than being server-refreshed (§4.8), set disableServerRefresh: true on the enclosing component so the child reclassifies under §4.9, or move the stateful island outside the refreshable target.",
      "SPEC §4.5/§4.9/§9.1 forbid an island declaring local state from rendering inside another component's inferred server-refreshable fragment target.",
      'Escape: document-lifetime-immutable local state is renderOnce and does not trip KV420.',
    ].join('\n'),
    severity: 'error',
    message:
      'Island with local state nested inside a server-refreshable fragment target loses its state on refresh.',
  },
  KV421: {
    code: 'KV421',
    help: [
      'Would lower to: one mutation fact per mutation key for the invalidation registry and server dispatch table.',
      'Blocked reason: two mutation declarations share one key, so graph indexing silently last-write-wins the invalidation set while server dispatch first-match-wins the handler — the two layers disagree, an invalidation can be computed for a mutation that never runs, and the wrong handler (with the wrong input schema and guards) executes against attacker-shaped input.',
      'Fixes: emit exactly one mutation fact per mutation key, or rename one mutation so its key is unique across the app graph.',
      'SPEC §6.1 makes the mutation registry key-addressed and §9.5 dispatches a POST to exactly one keyed handler; duplicate mutation keys would otherwise silently last-write-wins the invalidation registry while first-match-wins server dispatch — like routes (KV228), components (KV237), fragment targets (KV238), view transitions (KV239), and query shapes (KV240), mutation keys must be unique.',
    ].join('\n'),
    severity: 'error',
    message: 'Duplicate mutation key.',
  },
  KV422: {
    code: 'KV422',
    help: [
      'Would lower to: SQL text and SQL values crossing the managed DB seam as separate facts.',
      'Blocked reason: executable SQL text was built from an unbranded raw string, an unsafe raw chunk, or an unchecked identifier/keyword fragment, so request data could become SQL syntax instead of a bound value.',
      'Fixes: use Drizzle builders or Kovo sql`...` placeholders for scalar values, staticSql`...` for literal-only SQL text, sql.identifier(value, { allow }) or sql.allow(value, allowlist) for allowlisted identifiers/keywords, or trustedSql(..., { justification }) for the audited raw-SQL escape hatch.',
      'SPEC §10.2/§10.3 and §11.2 require framework-managed DB handles to reject unbranded executable SQL text independently from KV406/KV410 read/write freshness declarations.',
    ].join('\n'),
    severity: 'error',
    message: 'SQL text injection risk.',
  },
  KV423: {
    code: 'KV423',
    help: [
      'Would lower to: a raw endpoint audit row with explicit method, purpose/reason, mount scope, response body posture, cache posture, and app-owned encoding/header-safety declarations.',
      'Blocked reason: endpoint() is the raw HTTP escape hatch; without complete audit metadata, reviewers cannot tell why the route exists, what methods it accepts, or who owns output/header safety.',
      'Fixes: add the missing endpoint metadata, give prefix mounts a mountJustification, and keep csrf:false justifications separate from the endpoint purpose.',
      'SPEC §9.1 makes raw endpoint ingress registry-visible, and the source/sink inventory requires every raw endpoint to explain its trust and output posture.',
    ].join('\n'),
    severity: 'error',
    message: 'Raw endpoint declaration is missing required audit metadata.',
  },
  KV424: {
    code: 'KV424',
    help: [
      'Would lower to: a framework-owned safe helper, typed trust API, or registered source/sink row for the dangerous output operation.',
      'Blocked reason: app-authored direct writes to dangerous sinks such as raw HTML, URL/navigation, selectors, headers, files, dynamic import, eval, or process execution bypass Kovo contextual encoding and audit surfaces.',
      'Fixes: route the value through the corresponding Kovo helper, use an explicit trustedHtml/trustedUrl-style escape hatch with provenance, or move app-owned raw protocol code behind an audited endpoint.',
      'SPEC §4.8, §5.2 rule 10, and §9.1 require dangerous sinks to be safe-by-default or explicit in the source/sink inventory.',
    ].join('\n'),
    severity: 'error',
    message: 'App-authored dangerous sink is not registered or behind a safe Kovo surface.',
  },
  KV425: {
    code: 'KV425',
    help: [
      'Would lower to: a source/sink registry entry, runtime chokepoint, diagnostic, or explicit repo-internal exclusion for each dangerous framework sink token found by drift detection.',
      'Blocked reason: a new framework-owned sink appeared without being enrolled in the generated source/sink inventory, so future audits can miss a path from attacker-controlled input to output.',
      'Fixes: add the sink to the shared registry with spec/test evidence, attach it to an existing safe chokepoint, or record a narrow exclusion proving it is build/test-only or outside request paths.',
      'The source/sink plan requires drift detection for sink tokens such as innerHTML, Headers, Location, Set-Cookie, querySelector, import(), new Function, child_process, fs, and path resolution.',
    ].join('\n'),
    severity: 'error',
    message: 'Framework source/sink registry drift detected an unregistered sink.',
  },
  KV426: {
    code: 'KV426',
    help: [
      'Would lower to: a trust-audit row naming the escape hatch, source span, justification, and owning safe path or app review boundary.',
      'Blocked reason: raw endpoint, trustedHtml/trustedUrl, custom/no verifier, static export path override, or future trustedSql use without provenance becomes invisible to kovo explain --trust.',
      'Fixes: add a named justification/source span, use a typed safe helper instead of the escape hatch, or remove the trust override.',
      'SPEC §4.8 and §9.1 allow trust escape hatches only when they are explicit and auditable.',
    ].join('\n'),
    severity: 'error',
    message: 'Trust escape hatch lacks auditable provenance.',
  },
  KV431: {
    code: 'KV431',
    help: [
      'Would lower to: a static/export client-module manifest containing every client module URL referenced by route documents.',
      'Blocked reason: a route document references a client module that cannot be replayed as immutable same-origin JavaScript, so a static host or CSP manifest would publish an incomplete client runtime.',
      'Fixes: reference production versioned /c/__v/... client module URLs emitted by Kovo, keep one immutable version per output path, or remove the stale client module reference.',
      "SPEC §6.6 and §9.5 require client module references to stay same-origin, immutable, and complete under the framework's CSP/export manifest.",
    ].join('\n'),
    severity: 'error',
    message: 'Client module reference is absent from the CSP/export manifest.',
  },
  KV435: {
    code: 'KV435',
    help: [
      'Would lower to: a client-readable kovo-query payload embedded in the document and hydrated by the browser query store.',
      'Blocked reason: the projected query shape contains a secret-classified field, or an opaque/unresolved projection reads a table carrying secret columns, so rendering this query could serialize confidential data onto the client wire.',
      'Fixes: remove the secret field or opaque projection, select explicit non-secret columns, select a non-secret surrogate, or add an explicit reveal/redaction escape once the audited reveal surface lands.',
      'SPEC §6.2, §10.2, and §11.3 make query results JsonValue-bounded client wire values; a secret-classified or unprovable secret-table projection is ineligible for that boundary.',
    ].join('\n'),
    severity: 'error',
    message: 'Secret query value reaches the client wire.',
  },
  KV436: {
    code: 'KV436',
    help: [
      'Would lower to: a query, mutation, route, endpoint, or webhook with a total access decision recorded in the app graph.',
      'Blocked reason: the surface has no explicit access decision, so review cannot distinguish an intentional public or machine-verified entry from an accidentally reachable handler.',
      'Fixes: add an access guard chain, public("reason"), or verified machine-auth decision; use kovo explain --access to inspect the ledger before enabling the strict gate.',
      'SPEC §10.2/§11.3 and the secure-by-construction Phase 2 plan require authorization to be default-deny through explicit access decisions, not through inferred defaults.',
    ].join('\n'),
    severity: 'error',
    message: 'Missing explicit access decision.',
  },
  KV437: {
    code: 'KV437',
    help: [
      'Would lower to: a Drizzle write whose governed columns are assigned only from literals, current row values, or proven server/private-scope values.',
      'Blocked reason: client input or unproven data can assign an owner, primary key, or explicitly governed column, which would bypass the table-level ownership and identity facts declared once in schema.',
      'Fixes: derive owner/identity values on the server, remove governed keys from client payload writes, replace spreads/whole-object values with explicit non-governed fields, or use the audited adminAssign escape once it lands.',
      'SPEC §10.1, §10.3, and §11.1 make owner columns and primary keys governed write boundaries, proven by symbol provenance rather than lexical source matching.',
    ].join('\n'),
    severity: 'error',
    message: 'Client input reaches a governed column write.',
  },
} as const satisfies Record<DiagnosticCode, DiagnosticDefinition>;
