/**
 * SPEC §8 (spec/07-navigation.md): the `kovo-document-parts/v1` enhanced-navigation encoding.
 *
 * The server converts its own canonical rendered document — the exact SPEC §8 full-document
 * oracle — into a structured JSON part tree so the browser applier can build DOM through
 * `createElement`/`setAttribute`/`createTextNode` without ever handing an HTML string to a
 * string→DOM sink. This keeps `require-trusted-types-for 'script'` intact on the navigation
 * path instead of authorising a parser policy (plans/good-perf.md D2).
 *
 * The tokenizer below is deliberately fail-closed: it understands the dialect the framework
 * serializer emits (plus well-formed app `trustedHtml`), replicates the small set of HTML
 * tree-construction normalizations that apply to that dialect (implied `<tbody>`/`<colgroup>`,
 * the direct-parent `<p>` implied end tag, raw-text/RCDATA content, leading-newline removal in
 * `pre`/`textarea`, foreign-content case adjustment), and REFUSES everything it cannot prove it
 * would build the way the browser parser would. A refusal is not an error: the caller serves
 * the canonical `text/html` document instead and the client performs the normal full GET
 * (SPEC §8 fallback contract). Enhanced navigation degrades to a full load; it never degrades
 * to a wrong or unsafe DOM.
 *
 * A parts document is inert by construction: any executable script (a `<script>` whose `type`
 * is not exactly `application/json`, or carrying `src`), any native event-handler attribute
 * (`on*`), `srcdoc`, `is`, and `<base>` all refuse encoding. The client applier therefore never
 * constructs a Trusted Types script sink.
 *
 * @internal
 */

// SPEC §6.6: server framework modules load before app modules, so module-init captures are the
// boot authority; a later same-realm prototype mutation cannot redirect the encoder.
const reflectApply = Reflect.apply;
const jsonStringify = JSON.stringify;
const stringFromCodePoint = String.fromCodePoint;
const numberParseInt = Number.parseInt;
const numberIsSafeInteger = Number.isSafeInteger;
const objectAssign = Object.assign;
const objectCreate = Object.create;
const protoStringSlice = String.prototype.slice;
const protoStringIndexOf = String.prototype.indexOf;
const protoStringToLowerCase = String.prototype.toLowerCase;
const protoStringStartsWith = String.prototype.startsWith;
const protoRegExpExec = RegExp.prototype.exec;
const protoRegExpTest = RegExp.prototype.test;

function sSlice(value: string, start: number, end?: number): string {
  return reflectApply(protoStringSlice, value, end === undefined ? [start] : [start, end]) as string;
}
function sIndexOf(value: string, search: string, from?: number): number {
  return reflectApply(
    protoStringIndexOf,
    value,
    from === undefined ? [search] : [search, from],
  ) as number;
}
function sLower(value: string): string {
  return reflectApply(protoStringToLowerCase, value, []) as string;
}
function sStartsWith(value: string, search: string): boolean {
  return reflectApply(protoStringStartsWith, value, [search]) as boolean;
}
function rExec(pattern: RegExp, value: string): RegExpExecArray | null {
  return reflectApply(protoRegExpExec, pattern, [value]) as RegExpExecArray | null;
}
function rTest(pattern: RegExp, value: string): boolean {
  // RegExp.prototype.test consults a possibly-poisoned `exec`; route through the captured exec.
  return rExec(pattern, value) !== null;
}
function nullMap<Value>(entries: Record<string, Value>): Record<string, Value> {
  // Null-prototype lookup tables: a tag or attribute literally named `constructor` must miss,
  // and a hostile `Object.prototype` write must not add members.
  return objectAssign(objectCreate(null) as Record<string, Value>, entries);
}

/** @internal Wire protocol identity carried in every envelope. */
export const DOCUMENT_PARTS_PROTOCOL = 'kovo-document-parts/v1';

/** @internal Exact response Content-Type for a parts document. */
export const DOCUMENT_PARTS_CONTENT_TYPE =
  'application/vnd.kovo.document-parts+json; charset=utf-8';

/** @internal Namespace tags on the wire: 0/absent = HTML, 1 = SVG, 2 = MathML. */
type PartsNamespace = 0 | 1 | 2;

type AttrPart = readonly [name: string] | readonly [name: string, value: string];

/**
 * One wire part (SPEC §8):
 * - a JSON string is a text node (already entity-decoded);
 * - `["!", text]` is a comment node;
 * - `[tag, attrs, children]` is an HTML-namespace element;
 * - `[tag, attrs, children, ns]` is a foreign element (ns 1 = SVG, 2 = MathML).
 */
type Part = string | readonly unknown[];

interface OpenElement {
  attrs: AttrPart[];
  children: Part[];
  /** True for an implied `tbody`/`colgroup` the tokenizer synthesized (closed implicitly). */
  implied: boolean;
  ns: PartsNamespace;
  tag: string;
}

class DocumentPartsRefusal extends Error {}

function refuse(reason: string): never {
  throw new DocumentPartsRefusal(reason);
}

const VOID_ELEMENTS = nullMap<true>({
  area: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
});

/** Elements the framework never emits and whose parser semantics we refuse to model. */
const REFUSED_ELEMENTS = nullMap<true>({
  base: true,
  body: true,
  frame: true,
  frameset: true,
  head: true,
  html: true,
  image: true,
  isindex: true,
  noembed: true,
  noframes: true,
  plaintext: true,
  xmp: true,
});

/** Raw-text content models (scripting-enabled parser semantics for noscript/iframe). */
const RAW_TEXT_ELEMENTS = nullMap<true>({
  iframe: true,
  noscript: true,
  script: true,
  style: true,
});

const RCDATA_ELEMENTS = nullMap<true>({ textarea: true, title: true });

/** Start tags that imply an end tag for an open `<p>` (HTML "in body" insertion mode). */
const P_CLOSERS = nullMap<true>({
  address: true,
  article: true,
  aside: true,
  blockquote: true,
  details: true,
  dialog: true,
  dir: true,
  div: true,
  dl: true,
  fieldset: true,
  figcaption: true,
  figure: true,
  footer: true,
  form: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  header: true,
  hgroup: true,
  hr: true,
  listing: true,
  main: true,
  menu: true,
  nav: true,
  ol: true,
  p: true,
  pre: true,
  search: true,
  section: true,
  summary: true,
  table: true,
  ul: true,
});

/** Button-scope barriers for the open-`<p>` ambiguity refusal. */
const P_SCOPE_BARRIERS = nullMap<true>({
  button: true,
  caption: true,
  html: true,
  marquee: true,
  object: true,
  table: true,
  td: true,
  template: true,
  th: true,
});

/**
 * Start tags whose parser handling closes a same-name or sibling-class open element through
 * implied end tags. The serializer always emits explicit end tags, so any occurrence means
 * misnested app `trustedHtml` — refuse rather than model the restructure.
 */
const IMPLIED_END_AMBIGUITY = nullMap<readonly string[]>({
  dd: ['dd', 'dt'],
  dt: ['dd', 'dt'],
  li: ['li'],
  optgroup: ['optgroup', 'option'],
  option: ['option'],
  rp: ['rp', 'rt'],
  rt: ['rp', 'rt'],
});

/** Nesting the adoption agency or form pointer would restructure — refuse on sight. */
const NO_NESTING = nullMap<true>({
  a: true,
  button: true,
  form: true,
  nobr: true,
  select: true,
});

const HEADINGS = nullMap<true>({
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
});

/** Elements the "in head" insertion mode accepts without closing `<head>`. */
const HEAD_ELEMENTS = nullMap<true>({
  link: true,
  meta: true,
  noscript: true,
  script: true,
  style: true,
  template: true,
  title: true,
});

/** Foreign-content breakout start tags (HTML "in foreign content" rules) — refuse. */
const FOREIGN_BREAKOUT = nullMap<true>({
  b: true,
  big: true,
  blockquote: true,
  body: true,
  br: true,
  center: true,
  code: true,
  dd: true,
  div: true,
  dl: true,
  dt: true,
  em: true,
  embed: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  head: true,
  hr: true,
  i: true,
  img: true,
  li: true,
  listing: true,
  menu: true,
  meta: true,
  nobr: true,
  ol: true,
  p: true,
  pre: true,
  ruby: true,
  s: true,
  small: true,
  span: true,
  strong: true,
  strike: true,
  sub: true,
  sup: true,
  table: true,
  tt: true,
  u: true,
  ul: true,
  var: true,
});

/** SVG tag-name case adjustment (HTML tree construction, foreign content). */
const SVG_TAG_ADJUST = nullMap<string>({
  altglyph: 'altGlyph',
  altglyphdef: 'altGlyphDef',
  altglyphitem: 'altGlyphItem',
  animatecolor: 'animateColor',
  animatemotion: 'animateMotion',
  animatetransform: 'animateTransform',
  clippath: 'clipPath',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite',
  feconvolvematrix: 'feConvolveMatrix',
  fediffuselighting: 'feDiffuseLighting',
  fedisplacementmap: 'feDisplacementMap',
  fedistantlight: 'feDistantLight',
  fedropshadow: 'feDropShadow',
  feflood: 'feFlood',
  fefunca: 'feFuncA',
  fefuncb: 'feFuncB',
  fefuncg: 'feFuncG',
  fefuncr: 'feFuncR',
  fegaussianblur: 'feGaussianBlur',
  feimage: 'feImage',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  femorphology: 'feMorphology',
  feoffset: 'feOffset',
  fepointlight: 'fePointLight',
  fespecularlighting: 'feSpecularLighting',
  fespotlight: 'feSpotLight',
  fetile: 'feTile',
  feturbulence: 'feTurbulence',
  foreignobject: 'foreignObject',
  glyphref: 'glyphRef',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  textpath: 'textPath',
});

/** SVG attribute case adjustment (HTML tree construction "adjust SVG attributes"). */
const SVG_ATTR_ADJUST = nullMap<string>({
  attributename: 'attributeName',
  attributetype: 'attributeType',
  basefrequency: 'baseFrequency',
  baseprofile: 'baseProfile',
  calcmode: 'calcMode',
  clippathunits: 'clipPathUnits',
  diffuseconstant: 'diffuseConstant',
  edgemode: 'edgeMode',
  filterunits: 'filterUnits',
  glyphref: 'glyphRef',
  gradienttransform: 'gradientTransform',
  gradientunits: 'gradientUnits',
  kernelmatrix: 'kernelMatrix',
  kernelunitlength: 'kernelUnitLength',
  keypoints: 'keyPoints',
  keysplines: 'keySplines',
  keytimes: 'keyTimes',
  lengthadjust: 'lengthAdjust',
  limitingconeangle: 'limitingConeAngle',
  markerheight: 'markerHeight',
  markerunits: 'markerUnits',
  markerwidth: 'markerWidth',
  maskcontentunits: 'maskContentUnits',
  maskunits: 'maskUnits',
  numoctaves: 'numOctaves',
  pathlength: 'pathLength',
  patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform',
  patternunits: 'patternUnits',
  pointsatx: 'pointsAtX',
  pointsaty: 'pointsAtY',
  pointsatz: 'pointsAtZ',
  preservealpha: 'preserveAlpha',
  preserveaspectratio: 'preserveAspectRatio',
  primitiveunits: 'primitiveUnits',
  refx: 'refX',
  refy: 'refY',
  repeatcount: 'repeatCount',
  repeatdur: 'repeatDur',
  requiredextensions: 'requiredExtensions',
  requiredfeatures: 'requiredFeatures',
  specularconstant: 'specularConstant',
  specularexponent: 'specularExponent',
  spreadmethod: 'spreadMethod',
  startoffset: 'startOffset',
  stddeviation: 'stdDeviation',
  stitchtiles: 'stitchTiles',
  surfacescale: 'surfaceScale',
  systemlanguage: 'systemLanguage',
  tablevalues: 'tableValues',
  targetx: 'targetX',
  targety: 'targetY',
  textlength: 'textLength',
  viewbox: 'viewBox',
  viewtarget: 'viewTarget',
  xchannelselector: 'xChannelSelector',
  ychannelselector: 'yChannelSelector',
  zoomandpan: 'zoomAndPan',
});

/** MathML attribute adjustment. */
const MATHML_ATTR_ADJUST = nullMap<string>({ definitionurl: 'definitionURL' });

/** MathML text integration points (children parse as HTML). */
const MATHML_TEXT_INTEGRATION = nullMap<true>({
  mi: true,
  mn: true,
  mo: true,
  ms: true,
  mtext: true,
});

/** SVG HTML integration points (children parse as HTML). */
const SVG_HTML_INTEGRATION = nullMap<true>({
  desc: true,
  foreignObject: true,
  title: true,
});

/**
 * Named character references the encoder decodes (with the terminating `;`). Any other
 * `&name;` refuses: the browser's table is far larger, so an unknown name here could decode
 * differently there.
 */
const NAMED_ENTITIES = nullMap<string>({
  AMP: '&',
  Dagger: '‡',
  GT: '>',
  LT: '<',
  Prime: '″',
  QUOT: '"',
  amp: '&',
  apos: "'",
  bull: '•',
  cent: '¢',
  copy: '©',
  curren: '¤',
  dagger: '†',
  darr: '↓',
  deg: '°',
  divide: '÷',
  euro: '€',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  ge: '≥',
  gt: '>',
  harr: '↔',
  hellip: '…',
  iexcl: '¡',
  infin: '∞',
  iquest: '¿',
  laquo: '«',
  larr: '←',
  ldquo: '“',
  le: '≤',
  lsquo: '‘',
  mdash: '—',
  micro: 'µ',
  middot: '·',
  minus: '−',
  nbsp: ' ',
  ndash: '–',
  ne: '≠',
  not: '¬',
  para: '¶',
  permil: '‰',
  plusmn: '±',
  pound: '£',
  prime: '′',
  quot: '"',
  raquo: '»',
  rarr: '→',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  sect: '§',
  shy: '­',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  szlig: 'ß',
  times: '×',
  trade: '™',
  uarr: '↑',
  yen: '¥',
});

/**
 * WHATWG named references usable WITHOUT a terminating semicolon. A bare `&` run that begins
 * with one of these is ambiguous between literal text and a legacy decode — refuse.
 */
const LEGACY_ENTITY_PREFIXES = [
  'AElig', 'AMP', 'Aacute', 'Acirc', 'Agrave', 'Aring', 'Atilde', 'Auml', 'COPY', 'Ccedil',
  'ETH', 'Eacute', 'Ecirc', 'Egrave', 'Euml', 'GT', 'Iacute', 'Icirc', 'Igrave', 'Iuml', 'LT',
  'Ntilde', 'Oacute', 'Ocirc', 'Ograve', 'Oslash', 'Otilde', 'Ouml', 'QUOT', 'REG', 'THORN',
  'Uacute', 'Ucirc', 'Ugrave', 'Uuml', 'Yacute', 'aacute', 'acirc', 'acute', 'aelig', 'agrave',
  'amp', 'aring', 'atilde', 'auml', 'brvbar', 'ccedil', 'cedil', 'cent', 'copy', 'curren',
  'deg', 'divide', 'eacute', 'ecirc', 'egrave', 'eth', 'euml', 'frac12', 'frac14', 'frac34',
  'gt', 'iacute', 'icirc', 'iexcl', 'igrave', 'iquest', 'iuml', 'laquo', 'lt', 'macr', 'micro',
  'middot', 'nbsp', 'not', 'ntilde', 'oacute', 'ocirc', 'ograve', 'ordf', 'ordm', 'oslash',
  'otilde', 'ouml', 'para', 'plusmn', 'pound', 'quot', 'raquo', 'reg', 'sect', 'shy', 'sup1',
  'sup2', 'sup3', 'szlig', 'thorn', 'times', 'uacute', 'ucirc', 'ugrave', 'uml', 'uuml',
  'yacute', 'yen', 'yuml',
] as const;

const MAX_PARTS = 262_144;

interface Tokenizer {
  html: string;
  length: number;
  parts: number;
  position: number;
}

/**
 * Encode the exact canonical rendered document as a `kovo-document-parts/v1` JSON body.
 *
 * Returns `undefined` when the document cannot be encoded with parser parity — the caller
 * MUST then serve the canonical `text/html` document so the client performs the normal full
 * GET (SPEC §8). `buildToken` is stamped as the envelope-level build identity the client
 * validates BEFORE constructing any DOM (SPEC §5.2.1/§14; plans/better-js-loader.md carried
 * constraint).
 *
 * @internal
 */
export function encodeEnhancedNavigationDocumentParts(
  html: string,
  buildToken: string,
): string | undefined {
  if (typeof html !== 'string' || typeof buildToken !== 'string' || buildToken === '') {
    return undefined;
  }
  try {
    return encodeDocumentParts(html, buildToken);
  } catch (error) {
    if (error instanceof DocumentPartsRefusal) return undefined;
    throw error;
  }
}

function encodeDocumentParts(rawHtml: string, buildToken: string): string {
  // The HTML parser normalizes CRLF and CR to LF before tokenization and replaces NUL. The
  // framework serializer emits neither byte; either one means an input we did not render.
  if (sIndexOf(rawHtml, '\0') >= 0) refuse('NUL byte');
  if (sIndexOf(rawHtml, '\r') >= 0) refuse('carriage return');
  const t: Tokenizer = { html: rawHtml, length: rawHtml.length, parts: 0, position: 0 };

  skipWhitespace(t);
  expectCaseInsensitive(t, '<!doctype html>');
  skipWhitespace(t);
  const htmlAttrs = expectStartTagWithAttrs(t, 'html');
  skipWhitespace(t);
  const headAttrs = expectStartTagWithAttrs(t, 'head');
  if (headAttrs.length > 0) refuse('attributed head');
  const head = readChildren(t, 'head');
  expectCaseInsensitive(t, '</head>');
  skipWhitespace(t);
  const bodyAttrs = expectStartTagWithAttrs(t, 'body');
  const body = readChildren(t, 'body');
  expectCaseInsensitive(t, '</body>');
  skipWhitespace(t);
  expectCaseInsensitive(t, '</html>');
  skipWhitespace(t);
  if (t.position !== t.length) refuse('trailing content');

  return jsonStringify({
    body,
    bodyAttrs,
    build: buildToken,
    head,
    htmlAttrs,
    protocol: DOCUMENT_PARTS_PROTOCOL,
  }) as string;
}

function skipWhitespace(t: Tokenizer): void {
  while (t.position < t.length) {
    const ch = t.html[t.position];
    if (ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\f') return;
    t.position += 1;
  }
}

function expectCaseInsensitive(t: Tokenizer, expected: string): void {
  const slice = sSlice(t.html, t.position, t.position + expected.length);
  if (sLower(slice) !== expected) refuse(`expected ${expected}`);
  t.position += expected.length;
}

function expectStartTagWithAttrs(t: Tokenizer, tag: string): AttrPart[] {
  expectCaseInsensitive(t, `<${tag}`);
  const boundary = t.html[t.position];
  if (boundary !== '>' && boundary !== ' ' && boundary !== '\n' && boundary !== '\t') {
    refuse(`malformed ${tag} start tag`);
  }
  const read = readAttributes(t, 0, tag);
  if (read.selfClosed) refuse(`self-closing ${tag}`);
  return read.attrs;
}

/** Read attributes up to and including the closing `>` (or admissible `/>`). */
function readAttributes(
  t: Tokenizer,
  ns: PartsNamespace,
  tag: string,
): { attrs: AttrPart[]; selfClosed: boolean } {
  const attrs: AttrPart[] = [];
  const seen = objectCreate(null) as Record<string, true>;
  while (true) {
    skipWhitespace(t);
    if (t.position >= t.length) refuse('unterminated start tag');
    const ch = t.html[t.position];
    if (ch === '>') {
      t.position += 1;
      return { attrs, selfClosed: false };
    }
    if (ch === '/') {
      if (t.html[t.position + 1] !== '>') refuse('stray slash in start tag');
      // In HTML content the trailing slash is ignored, which leaves a non-void element OPEN
      // while the markup author almost certainly meant it closed — irreconcilable, refuse.
      // Void and foreign elements close identically either way.
      if (ns === 0 && VOID_ELEMENTS[tag] !== true) refuse('self-closing non-void HTML element');
      t.position += 2;
      return { attrs, selfClosed: true };
    }
    let name = '';
    while (t.position < t.length) {
      const nameCh = t.html[t.position]!;
      if (
        nameCh === '=' ||
        nameCh === '>' ||
        nameCh === '/' ||
        nameCh === ' ' ||
        nameCh === '\n' ||
        nameCh === '\t' ||
        nameCh === '\f'
      ) {
        break;
      }
      name += nameCh;
      t.position += 1;
    }
    if (name === '' || !rTest(/^[a-zA-Z][a-zA-Z0-9_.:-]*$/u, name)) refuse('attribute name');
    name = sLower(name);
    if (ns === 1 && SVG_ATTR_ADJUST[name] !== undefined) name = SVG_ATTR_ADJUST[name]!;
    if (ns === 2 && MATHML_ATTR_ADJUST[name] !== undefined) name = MATHML_ATTR_ADJUST[name]!;
    // SPEC §6.6/§8: a parts document must stay inert. Native event-handler content attributes
    // are Trusted Types script sinks; srcdoc is an HTML sink; `is` selects a customized
    // built-in the applier cannot reproduce with plain createElement.
    if (rTest(/^on[a-z]+$/u, name)) refuse('event handler attribute');
    if (name === 'srcdoc' || name === 'is') refuse(`${name} attribute`);
    if (seen[name] === true) refuse('duplicate attribute');
    seen[name] = true;
    skipWhitespace(t);
    if (t.html[t.position] !== '=') {
      attrs[attrs.length] = [name];
      continue;
    }
    t.position += 1;
    skipWhitespace(t);
    const quote = t.html[t.position];
    if (quote !== '"' && quote !== "'") refuse('unquoted attribute value');
    t.position += 1;
    const end = sIndexOf(t.html, quote, t.position);
    if (end < 0) refuse('unterminated attribute value');
    const raw = sSlice(t.html, t.position, end);
    t.position = end + 1;
    attrs[attrs.length] = [name, decodeEntities(raw)];
  }
}

function decodeEntities(text: string): string {
  if (sIndexOf(text, '&') < 0) return text;
  let decoded = '';
  let position = 0;
  while (position < text.length) {
    const amp = sIndexOf(text, '&', position);
    if (amp < 0) {
      decoded += sSlice(text, position);
      return decoded;
    }
    decoded += sSlice(text, position, amp);
    const next = text[amp + 1];
    if (next === '#') {
      const hex = text[amp + 2] === 'x' || text[amp + 2] === 'X';
      const digitsStart = amp + (hex ? 3 : 2);
      let digitsEnd = digitsStart;
      while (
        digitsEnd < text.length &&
        (hex
          ? rTest(/^[0-9a-fA-F]$/u, text[digitsEnd]!)
          : text[digitsEnd]! >= '0' && text[digitsEnd]! <= '9')
      ) {
        digitsEnd += 1;
      }
      if (digitsEnd === digitsStart || text[digitsEnd] !== ';') refuse('numeric reference');
      const code = numberParseInt(sSlice(text, digitsStart, digitsEnd), hex ? 16 : 10);
      // The parser maps controls, NUL, surrogates, and noncharacters through replacement
      // tables — decode divergence risk, refuse anything outside plain scalar text.
      if (
        !numberIsSafeInteger(code) ||
        code > 0x10ffff ||
        (code < 0x20 && code !== 0x9 && code !== 0xa) ||
        code === 0x7f ||
        (code >= 0x80 && code <= 0x9f) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        (code >= 0xfdd0 && code <= 0xfdef) ||
        (code & 0xfffe) === 0xfffe
      ) {
        refuse('numeric reference value');
      }
      decoded += stringFromCodePoint(code) as string;
      position = digitsEnd + 1;
      continue;
    }
    if (next !== undefined && rTest(/^[a-zA-Z]$/u, next)) {
      let runEnd = amp + 1;
      while (runEnd < text.length && rTest(/^[a-zA-Z0-9]$/u, text[runEnd]!)) runEnd += 1;
      const run = sSlice(text, amp + 1, runEnd);
      if (text[runEnd] === ';') {
        const value = NAMED_ENTITIES[run];
        if (value === undefined) refuse(`named reference &${run};`);
        decoded += value;
        position = runEnd + 1;
        continue;
      }
      // No semicolon: the browser still decodes the WHATWG legacy set. A run that begins with
      // a legacy name is ambiguous — refuse; anything else is literal text.
      for (let index = 0; index < LEGACY_ENTITY_PREFIXES.length; index += 1) {
        if (sStartsWith(run, LEGACY_ENTITY_PREFIXES[index]!)) {
          refuse('legacy reference without semicolon');
        }
      }
      decoded += '&';
      position = amp + 1;
      continue;
    }
    // `&` not followed by an alphanumeric or `#` is literal text in every parser state we
    // accept.
    decoded += '&';
    position = amp + 1;
  }
  return decoded;
}

function isWhitespaceOnly(text: string): boolean {
  return rTest(/^[ \t\n\f]*$/u, text);
}

/**
 * Read element children until the exact structural closing tag of `context` is next; the
 * caller consumes that closing tag itself.
 */
function readChildren(t: Tokenizer, context: 'head' | 'body'): Part[] {
  const root: OpenElement = { attrs: [], children: [], implied: false, ns: 0, tag: context };
  const stack: OpenElement[] = [root];
  const closing = `</${context}>`;

  while (true) {
    if (t.position >= t.length) refuse('unterminated document');
    if (stack.length === 1) {
      const slice = sLower(sSlice(t.html, t.position, t.position + closing.length));
      if (slice === closing) return root.children;
    }
    step(t, stack, context);
  }
}

function currentOpen(stack: OpenElement[]): OpenElement {
  return stack[stack.length - 1]!;
}

function countPart(t: Tokenizer): void {
  t.parts += 1;
  if (t.parts > MAX_PARTS) refuse('part budget');
}

function appendPart(t: Tokenizer, stack: OpenElement[], part: Part): void {
  countPart(t);
  const parent = currentOpen(stack).children;
  parent[parent.length] = part;
}

function step(t: Tokenizer, stack: OpenElement[], context: 'head' | 'body'): void {
  const ch = t.html[t.position];
  if (ch !== '<') {
    readText(t, stack, context);
    return;
  }
  const next = t.html[t.position + 1];
  if (next === '!') {
    if (sSlice(t.html, t.position + 2, t.position + 4) === '--') {
      const end = sIndexOf(t.html, '-->', t.position + 4);
      if (end < 0) refuse('unterminated comment');
      const text = sSlice(t.html, t.position + 4, end);
      // Comment-content edge cases (`<!-->`, `--!>`) tokenize differently — refuse.
      if (sStartsWith(text, '>') || sStartsWith(text, '->') || sIndexOf(text, '--!>') >= 0) {
        refuse('comment content');
      }
      appendPart(t, stack, ['!', text]);
      t.position = end + 3;
      return;
    }
    refuse('markup declaration');
  }
  if (next === '?') refuse('processing instruction');
  if (next === '/') {
    readEndTag(t, stack);
    return;
  }
  if (next === undefined || !rTest(/^[a-zA-Z]$/u, next)) {
    // A lone `<` before a non-letter is literal text in the parser, but the serializer always
    // escapes it — treat as trustedHtml ambiguity and refuse.
    refuse('bare <');
  }
  readStartTag(t, stack, context);
}

function readText(t: Tokenizer, stack: OpenElement[], context: 'head' | 'body'): void {
  const nextTag = sIndexOf(t.html, '<', t.position);
  const end = nextTag < 0 ? t.length : nextTag;
  let raw = sSlice(t.html, t.position, end);
  t.position = end;
  const open = currentOpen(stack);
  // The parser drops one LITERAL leading newline in pre/listing (a decoded `&#10;` stays).
  if (
    (open.tag === 'pre' || open.tag === 'listing') &&
    open.children.length === 0 &&
    sStartsWith(raw, '\n')
  ) {
    raw = sSlice(raw, 1);
  }
  const text = decodeEntities(raw);
  if (text === '') return;
  if (context === 'head' && stack.length === 1 && !isWhitespaceOnly(text)) {
    // Non-whitespace head text closes <head> in the real parser — structural divergence.
    refuse('head text');
  }
  const tag = open.tag;
  if (open.ns === 0 && !isWhitespaceOnly(text)) {
    if (tag === 'table' || tag === 'tbody' || tag === 'thead' || tag === 'tfoot' || tag === 'tr') {
      // Foster parenting would relocate this text outside the table.
      refuse('table text');
    }
    if (tag === 'select' || tag === 'optgroup') refuse('select text');
  }
  appendPart(t, stack, text);
}

function readEndTag(t: Tokenizer, stack: OpenElement[]): void {
  const match = rExec(/^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/u, sSlice(t.html, t.position));
  if (!match) refuse('end tag');
  let name = sLower(match[1]!);
  if (stack.length === 1) refuse('stray end tag');
  const open = currentOpen(stack);
  if (open.ns === 1 && SVG_TAG_ADJUST[name] !== undefined) name = SVG_TAG_ADJUST[name]!;
  if (open.implied && (name === 'table' || name === 'colgroup')) {
    // An implied tbody/colgroup closes when its table context closes.
    closeOpenElement(t, stack);
    readEndTag(t, stack);
    return;
  }
  if (name === 'p' && open.tag !== 'p') refuse('implied p end tag');
  if (open.tag !== name) refuse(`mismatched end tag </${name}> for <${open.tag}>`);
  t.position += match[0].length;
  closeOpenElement(t, stack);
}

function closeOpenElement(t: Tokenizer, stack: OpenElement[]): void {
  const open = stack.pop();
  if (!open || stack.length === 0) refuse('unbalanced close');
  const element: Part =
    open.ns === 0
      ? [open.tag, open.attrs, open.children]
      : [open.tag, open.attrs, open.children, open.ns];
  countPart(t);
  const parent = currentOpen(stack).children;
  parent[parent.length] = element;
}

function readStartTag(t: Tokenizer, stack: OpenElement[], context: 'head' | 'body'): void {
  const match = rExec(/^<([a-zA-Z][a-zA-Z0-9-]*)/u, sSlice(t.html, t.position));
  if (!match) refuse('start tag');
  let name = sLower(match[1]!);
  t.position += match[0].length;

  const parentNs = effectiveNamespace(stack);
  if (context === 'head' && stack.length === 1 && HEAD_ELEMENTS[name] !== true) {
    // Anything else in "in head" (including svg/math) closes head and reopens in body.
    refuse(`non-head element ${name} in head`);
  }
  let ns: PartsNamespace = parentNs;
  if (parentNs === 0) {
    if (name === 'svg') ns = 1;
    else if (name === 'math') ns = 2;
  } else if (parentNs === 1) {
    if (SVG_TAG_ADJUST[name] !== undefined) name = SVG_TAG_ADJUST[name]!;
    if (FOREIGN_BREAKOUT[name] === true) refuse('foreign content breakout');
  } else {
    if (name === 'annotation-xml' || name === 'mglyph' || name === 'malignmark') {
      refuse('mathml special element');
    }
    if (FOREIGN_BREAKOUT[name] === true) refuse('foreign content breakout');
  }

  if (ns === 0 && parentNs === 0) {
    const open = currentOpen(stack);
    if (REFUSED_ELEMENTS[name] === true) refuse(`element ${name}`);
    if (NO_NESTING[name] === true) {
      for (let index = stack.length - 1; index >= 1; index -= 1) {
        if (stack[index]!.tag === name && stack[index]!.ns === 0) refuse(`${name} nesting`);
      }
    }
    if (HEADINGS[name] === true && HEADINGS[open.tag] === true) refuse('heading nesting');
    const ambiguity = IMPLIED_END_AMBIGUITY[name];
    if (ambiguity !== undefined) {
      for (let index = 0; index < ambiguity.length; index += 1) {
        if (open.tag === ambiguity[index]) refuse(`${name} implied end`);
      }
    }
    if (P_CLOSERS[name] === true) {
      if (open.tag === 'p' && open.ns === 0) {
        // Exact parser behavior for the common case: the new start tag closes the open <p>.
        closeOpenElement(t, stack);
      } else {
        for (let index = stack.length - 1; index >= 1; index -= 1) {
          const candidate = stack[index]!;
          if (P_SCOPE_BARRIERS[candidate.tag] === true) break;
          if (candidate.tag === 'p' && candidate.ns === 0) refuse('deep open p');
        }
      }
    }
    applyTableNormalization(t, stack, name);
    applyContentModelChecks(stack, name);
  }

  const read = readAttributes(t, ns, name);
  const attrs = read.attrs;

  if (ns === 0 && name === 'script') validateInertScript(attrs);

  const parent = currentOpen(stack);
  if (ns === 0 && VOID_ELEMENTS[name] === true) {
    countPart(t);
    parent.children[parent.children.length] = [name, attrs, []];
    return;
  }
  if (read.selfClosed) {
    countPart(t);
    parent.children[parent.children.length] = [name, attrs, [], ns];
    return;
  }

  if (ns === 0 && (RAW_TEXT_ELEMENTS[name] === true || RCDATA_ELEMENTS[name] === true)) {
    const text = readRawText(t, name, RCDATA_ELEMENTS[name] === true);
    const children: Part[] = [];
    if (text !== '') {
      countPart(t);
      children[0] = text;
    }
    countPart(t);
    parent.children[parent.children.length] = [name, attrs, children];
    return;
  }

  stack[stack.length] = { attrs, children: [], implied: false, ns, tag: name };
}

/** Namespace of the insertion point, honoring SVG/MathML HTML integration points. */
function effectiveNamespace(stack: OpenElement[]): PartsNamespace {
  const open = currentOpen(stack);
  if (open.ns === 1 && SVG_HTML_INTEGRATION[open.tag] === true) return 0;
  if (open.ns === 2 && MATHML_TEXT_INTEGRATION[open.tag] === true) return 0;
  return open.ns;
}

function applyTableNormalization(t: Tokenizer, stack: OpenElement[], name: string): void {
  const open = currentOpen(stack);
  if (open.tag === 'table' && open.ns === 0) {
    if (name === 'tr') {
      // The parser inserts an implied <tbody> for a <tr> directly inside <table>.
      stack[stack.length] = { attrs: [], children: [], implied: true, ns: 0, tag: 'tbody' };
      return;
    }
    if (name === 'col') {
      stack[stack.length] = { attrs: [], children: [], implied: true, ns: 0, tag: 'colgroup' };
      return;
    }
    if (name === 'td' || name === 'th') refuse('cell directly in table');
    return;
  }
  if (open.implied && open.tag === 'tbody' && name !== 'tr') {
    // thead/tfoot/caption after an implied tbody restructures — refuse.
    refuse('implied tbody sibling');
  }
  if (open.implied && open.tag === 'colgroup' && name !== 'col') {
    closeOpenElement(t, stack);
    applyTableNormalization(t, stack, name);
  }
}

function applyContentModelChecks(stack: OpenElement[], name: string): void {
  const open = currentOpen(stack);
  if (open.ns !== 0) return;
  if (
    (open.tag === 'tbody' || open.tag === 'thead' || open.tag === 'tfoot') &&
    name !== 'tr' &&
    name !== 'script' &&
    name !== 'template'
  ) {
    refuse('table section child');
  }
  if (
    open.tag === 'tr' &&
    name !== 'td' &&
    name !== 'th' &&
    name !== 'script' &&
    name !== 'template'
  ) {
    refuse('row child');
  }
  if (
    open.tag === 'select' &&
    name !== 'option' &&
    name !== 'optgroup' &&
    name !== 'hr' &&
    name !== 'script' &&
    name !== 'template'
  ) {
    refuse('select child');
  }
  if ((name === 'td' || name === 'th') && open.tag !== 'tr' && open.tag !== 'template') {
    refuse('stray table cell');
  }
  if (
    name === 'tr' &&
    open.tag !== 'tbody' &&
    open.tag !== 'thead' &&
    open.tag !== 'tfoot' &&
    open.tag !== 'template'
  ) {
    refuse('stray table row');
  }
  if (
    (name === 'tbody' ||
      name === 'thead' ||
      name === 'tfoot' ||
      name === 'caption' ||
      name === 'colgroup') &&
    open.tag !== 'table' &&
    open.tag !== 'template'
  ) {
    refuse('stray table section');
  }
}

/**
 * SPEC §8: a parts document is inert. The only admissible scripts are the framework's JSON
 * data script (`type="application/json"`) and the Speculation Rules data block
 * (`type="speculationrules"`, D6/O9) — neither executes author JavaScript — and never with
 * `src`. Anything else refuses so the canonical `text/html` document (with its ordinary
 * full-GET semantics) is served instead.
 */
function validateInertScript(attrs: readonly AttrPart[]): void {
  let type: string | undefined;
  for (let index = 0; index < attrs.length; index += 1) {
    const attr = attrs[index]!;
    if (attr[0] === 'src') refuse('script src');
    if (attr[0] === 'type') type = attr.length > 1 ? attr[1] : '';
  }
  if (type !== 'application/json' && type !== 'speculationrules') refuse('executable script');
}

function readRawText(t: Tokenizer, tag: string, rcdata: boolean): string {
  const lower = sLower(t.html);
  const closing = `</${tag}`;
  let searchFrom = t.position;
  while (true) {
    const end = sIndexOf(lower, closing, searchFrom);
    if (end < 0) refuse(`unterminated ${tag}`);
    const after = t.html[end + closing.length];
    if (after !== '>' && after !== ' ' && after !== '\n' && after !== '\t' && after !== '/') {
      searchFrom = end + closing.length;
      continue;
    }
    const raw = sSlice(t.html, t.position, end);
    if (tag === 'script') {
      // Script-data double-escape states diverge; the framework's JSON scripts escape `<`.
      const lowered = sLower(raw);
      if (sIndexOf(lowered, '<!--') >= 0 || sIndexOf(lowered, '<script') >= 0) {
        refuse('script data escape');
      }
    }
    const close = rExec(/^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/u, sSlice(t.html, end));
    if (!close) refuse(`malformed ${tag} end tag`);
    t.position = end + close[0].length;
    // The parser drops one LITERAL leading newline in textarea (a decoded `&#10;` stays).
    const trimmed = tag === 'textarea' && sStartsWith(raw, '\n') ? sSlice(raw, 1) : raw;
    return rcdata ? decodeEntities(trimmed) : trimmed;
  }
}
