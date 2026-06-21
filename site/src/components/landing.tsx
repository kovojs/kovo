/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import { SiteFooter, SiteHeader, type ClientHrefs } from './chrome.js';

// Landing page (SPEC §7 L0): the "break it" pipeline is radio buttons + :has(),
// zero JavaScript. The page is authored as TSX route composition so the route
// compiler can derive enhanced-navigation page boundaries.
//
// The header and footer are the shared site chrome (SiteHeader/SiteFooter from
// chrome.tsx), so the landing matches the docs site and respects the theme
// toggle. All colors flow from the global design tokens (--bg/--ink/--teal/…
// in styles.css), so the page reads correctly in both light and dark themes;
// code terminals stay black in both, matching the docs' .code-window idiom.

const BRAND = 'Kovo';
const BRAND_CAPS = BRAND.toUpperCase();
const BRAND_CLI = BRAND.toLowerCase();

const landingStyles = style.create(
  {
    // The page inherits the global design tokens from styles.css (no local
    // overrides), so it tracks the light/dark theme like the rest of the site.
    root: {
      background: 'var(--bg)',
      color: 'var(--ink)',
      minHeight: '100vh',
    },
    link: {
      color: 'inherit',
      textDecoration: 'none',
    },
    wrap: {
      margin: '0 auto',
      maxWidth: '80rem',
      padding: '0 1.5rem',
    },
    hero: {
      alignItems: 'start',
      display: 'grid',
      gap: '4rem',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.08fr)',
      padding: '4rem 0 3.6rem',
      '@media (max-width: 64rem)': {
        gap: '2.5rem',
        gridTemplateColumns: '1fr',
      },
    },
    stencil: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'clamp(3.6rem, 8vw, 6.2rem)',
      fontWeight: 800,
      letterSpacing: '-0.04em',
      lineHeight: 0.92,
    },
    cursor: {
      animation: 'landing-blink 1.1s steps(1) 3',
      color: 'var(--teal)',
    },
    tagline: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      color: 'var(--ink)',
      fontSize: 'clamp(1.7rem, 3.4vw, 2.15rem)',
      fontWeight: 420,
      letterSpacing: '-0.02em',
      lineHeight: 1.28,
      marginTop: '1.4rem',
      maxWidth: '32rem',
      paddingTop: '1.3rem',
    },
    taglineEm: {
      color: 'var(--teal)',
      fontStyle: 'normal',
      fontWeight: 550,
    },
    taglineDim: {
      color: 'var(--dim)',
      whiteSpace: 'nowrap',
    },
    sub: {
      color: 'var(--dim)',
      fontSize: '1.02rem',
      lineHeight: 1.7,
      marginTop: '1.1rem',
      maxWidth: '29rem',
    },
    strong: {
      color: 'var(--ink)',
      fontWeight: 650,
    },
    noJs: {
      borderColor: 'color-mix(in srgb, var(--green) 35%, transparent)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--green)',
      display: 'inline-block',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      letterSpacing: '0.14em',
      marginTop: '1.2rem',
      padding: '0.35rem 0.7rem',
      textTransform: 'uppercase',
    },
    try: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1rem',
      marginTop: '1.8rem',
    },
    cmd: {
      alignItems: 'center',
      background: 'var(--panel)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.88rem',
      gap: '1rem',
      padding: '0.7rem 1.1rem',
    },
    dollar: {
      color: 'var(--teal)',
    },
    copyButton: {
      background: 'none',
      border: 'none',
      color: 'var(--faint)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      letterSpacing: '0.1em',
      margin: 0,
      padding: 0,
      textTransform: 'uppercase',
      ':hover': {
        color: 'var(--ink)',
      },
      '[data-copied]': {
        color: 'var(--teal)',
      },
    },
    go: {
      borderBottomColor: 'var(--teal)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      letterSpacing: '0.12em',
      paddingBottom: '0.15rem',
      textTransform: 'uppercase',
    },
    term: {
      background: '#000',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.8rem',
      lineHeight: 1.8,
    },
    termHead: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--faint)',
      display: 'flex',
      fontSize: '0.66rem',
      justifyContent: 'space-between',
      letterSpacing: '0.14em',
      padding: '0.55rem 1.1rem',
      textTransform: 'uppercase',
    },
    termPre: {
      color: '#e4e4e4',
      margin: 0,
      padding: '1.1rem 1.3rem 1.2rem',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    textDim: { color: 'var(--faint)' },
    textDel: { color: 'var(--red)' },
    textAdd: { color: 'var(--green)' },
    textErr: { color: 'var(--red)', fontWeight: 700 },
    textOk: { color: 'var(--green)' },
    textFix: { color: 'var(--teal)' },
    textLoc: { color: '#d8d8d8' },
    badge: {
      borderRadius: 2,
      fontSize: '0.62rem',
      fontWeight: 700,
      letterSpacing: '0.1em',
      padding: '0.06rem 0.42rem',
      verticalAlign: '0.08em',
    },
    badgeQuery: {
      borderColor: 'color-mix(in srgb, var(--sky) 40%, transparent)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--sky)',
    },
    badgeBind: {
      borderColor: 'color-mix(in srgb, var(--teal) 40%, transparent)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--teal)',
    },
    badgeForm: {
      borderColor: 'color-mix(in srgb, var(--amber) 40%, transparent)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--amber)',
    },
    badgeRoute: {
      borderColor: 'color-mix(in srgb, var(--purple) 40%, transparent)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--purple)',
    },
    cascadeSum: {
      borderTopColor: 'var(--edge-soft)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      color: 'var(--dim)',
      display: 'flex',
      fontSize: '0.74rem',
      justifyContent: 'space-between',
      letterSpacing: '0.04em',
      marginTop: '0.9rem',
      paddingTop: '0.8rem',
    },
    squiggle: {
      textDecoration: 'underline wavy var(--red) 2px',
      textUnderlineOffset: 5,
    },
    breakit: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      padding: '3.6rem 0 3.2rem',
      ':has(#brk-col:checked) [data-choice="col"]': {
        background: 'color-mix(in srgb, var(--red) 12%, transparent)',
        boxShadow: 'inset 0 -2px 0 var(--red)',
        color: 'var(--ink)',
      },
      ':has(#brk-query:checked) [data-choice="query"]': {
        background: 'color-mix(in srgb, var(--red) 12%, transparent)',
        boxShadow: 'inset 0 -2px 0 var(--red)',
        color: 'var(--ink)',
      },
      ':has(#brk-bind:checked) [data-choice="bind"]': {
        background: 'color-mix(in srgb, var(--red) 12%, transparent)',
        boxShadow: 'inset 0 -2px 0 var(--red)',
        color: 'var(--ink)',
      },
      ':has(#brk-col:checked) [data-link="col"] [data-wire], :has(#brk-query:checked) [data-link="query"] [data-wire], :has(#brk-bind:checked) [data-link="bind"] [data-wire]':
        {
          background: 'repeating-linear-gradient(90deg, var(--red) 0 6px, transparent 6px 12px)',
        },
      ':has(#brk-col:checked) [data-link="col"] [data-wire]::before, :has(#brk-col:checked) [data-link="col"] [data-wire]::after, :has(#brk-query:checked) [data-link="query"] [data-wire]::before, :has(#brk-query:checked) [data-link="query"] [data-wire]::after, :has(#brk-bind:checked) [data-link="bind"] [data-wire]::before, :has(#brk-bind:checked) [data-link="bind"] [data-wire]::after':
        {
          background: 'var(--red)',
        },
      ':has(#brk-col:checked) [data-link="col"] [data-check="ok"], :has(#brk-query:checked) [data-link="query"] [data-check="ok"], :has(#brk-bind:checked) [data-link="bind"] [data-check="ok"]':
        {
          display: 'none',
        },
      ':has(#brk-col:checked) [data-link="col"] [data-check="bad"], :has(#brk-query:checked) [data-link="query"] [data-check="bad"], :has(#brk-bind:checked) [data-link="bind"] [data-check="bad"]':
        {
          display: 'block',
        },
      ':has(#brk-col:checked) [data-node="database"], :has(#brk-query:checked) [data-node="query"], :has(#brk-bind:checked) [data-node="ui"]':
        {
          borderColor: 'color-mix(in srgb, var(--red) 55%, transparent)',
        },
      ':has(#brk-col:checked) [data-case="col"], :has(#brk-query:checked) [data-case="query"], :has(#brk-bind:checked) [data-case="bind"]':
        {
          display: 'block',
        },
    },
    sectionLabel: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.24em',
      marginBottom: '0.7rem',
      textTransform: 'uppercase',
    },
    pipeTitle: {
      color: 'var(--ink)',
      fontSize: '2.05rem',
      fontWeight: 530,
      letterSpacing: '-0.022em',
    },
    pipeSub: {
      color: 'var(--dim)',
      fontSize: '1rem',
      lineHeight: 1.6,
      marginTop: '0.6rem',
      maxWidth: '40rem',
    },
    radio: {
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
    },
    choices: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.74rem',
      letterSpacing: '0.06em',
      margin: '1.8rem 0 2rem',
    },
    choiceLabel: {
      borderRightColor: 'var(--edge)',
      borderRightStyle: 'solid',
      borderRightWidth: 1,
      color: 'var(--dim)',
      cursor: 'pointer',
      padding: '0.6rem 1.1rem',
      ':hover': {
        color: 'var(--ink)',
      },
    },
    choiceLabelLast: {
      borderRightWidth: 0,
    },
    choiceNumber: {
      color: 'var(--faint)',
      fontWeight: 500,
      marginRight: '0.5rem',
    },
    pipe: {
      alignItems: 'stretch',
      display: 'grid',
      gridTemplateColumns: '1fr 3.4rem 1fr 3.4rem 1fr 3.4rem 1fr',
      '@media (max-width: 64rem)': {
        gap: '0.6rem',
        gridTemplateColumns: '1fr',
      },
    },
    node: {
      background: 'var(--panel)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      padding: '1rem 1.1rem',
      position: 'relative',
      transition: 'border-color 0.2s',
    },
    nodeLabel: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      letterSpacing: '0.2em',
      marginBottom: '0.6rem',
      textTransform: 'uppercase',
    },
    nodePre: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      lineHeight: 1.7,
      margin: 0,
      whiteSpace: 'pre-wrap',
    },
    textHl: { color: 'var(--amber)' },
    textSt: { color: 'var(--green)' },
    textFn: { color: 'var(--sky)' },
    pipeLink: {
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem',
      justifyContent: 'center',
      padding: '0 0.3rem',
      '@media (max-width: 64rem)': {
        display: 'none',
      },
    },
    wire: {
      background:
        'linear-gradient(90deg, color-mix(in srgb, var(--teal) 55%, transparent), color-mix(in srgb, var(--teal) 25%, transparent))',
      borderRadius: 2,
      height: 2,
      position: 'relative',
      width: '100%',
      '::before': {
        background: 'var(--teal)',
        borderRadius: 9999,
        content: "''",
        height: 7,
        left: -3,
        position: 'absolute',
        top: -2.5,
        width: 7,
      },
      '::after': {
        background: 'var(--teal)',
        borderRadius: 9999,
        content: "''",
        height: 7,
        position: 'absolute',
        right: -3,
        top: -2.5,
        width: 7,
      },
    },
    check: {
      color: 'var(--green)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.58rem',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    },
    checkBad: {
      color: 'var(--red)',
      display: 'none',
    },
    caught: {
      marginTop: '1.6rem',
    },
    caughtTerm: {
      fontSize: '0.78rem',
    },
    casePanel: {
      display: 'none',
    },
    breakitFoot: {
      color: 'var(--faint)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      justifyContent: 'space-between',
      letterSpacing: '0.06em',
      marginTop: '1.1rem',
    },
    breakitFootStrong: {
      color: 'var(--teal)',
      fontWeight: 600,
    },
    split: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      gridTemplateColumns: '1.06fr 1fr',
      margin: '0 0 2.6rem',
      '@media (max-width: 64rem)': {
        gridTemplateColumns: '1fr',
      },
    },
    half: {
      padding: '1.8rem 2rem 2rem',
    },
    rightHalf: {
      borderLeftColor: 'var(--edge)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      '@media (max-width: 64rem)': {
        borderLeftWidth: 0,
        borderTopColor: 'var(--edge)',
        borderTopStyle: 'solid',
        borderTopWidth: 1,
      },
    },
    halfLabel: {
      fontFamily: 'var(--font-mono)',
      fontSize: '0.66rem',
      letterSpacing: '0.24em',
      marginBottom: '0.8rem',
      textTransform: 'uppercase',
    },
    agentLabel: { color: 'var(--teal)' },
    userLabel: { color: 'var(--sky)' },
    halfTitle: {
      fontSize: '1.4rem',
      fontWeight: 750,
      letterSpacing: '-0.018em',
      marginBottom: '0.55rem',
    },
    lead: {
      color: 'var(--dim)',
      fontSize: '0.94rem',
      lineHeight: 1.65,
      marginBottom: '1.2rem',
    },
    leadCode: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.85em',
    },
    timelines: {
      display: 'flex',
      flexDirection: 'column',
      gap: '1.3rem',
    },
    timeline: {
      background: 'var(--panel)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      padding: '1rem 1.2rem 1.1rem',
    },
    who: {
      color: 'var(--dim)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      justifyContent: 'space-between',
      letterSpacing: '0.2em',
      marginBottom: '0.9rem',
      textTransform: 'uppercase',
    },
    bad: { color: 'var(--red)' },
    good: { color: 'var(--green)' },
    track: {
      background: 'var(--panel)',
      borderRadius: 9999,
      height: '0.55rem',
      overflow: 'hidden',
      position: 'relative',
    },
    segment: {
      bottom: 0,
      position: 'absolute',
      top: 0,
    },
    // Page-load timelines as token-driven data-viz: neutral = idle, an amber
    // hatch = the JS-loading gap (wasted time), teal = interactive.
    spaS1: { background: 'var(--faint)', left: 0, width: '18%' },
    spaS2: {
      background:
        'repeating-linear-gradient(135deg, color-mix(in srgb, var(--amber) 55%, var(--panel)) 0 6px, color-mix(in srgb, var(--amber) 20%, var(--panel)) 6px 12px)',
      left: '18%',
      width: '54%',
    },
    spaS3: { background: 'color-mix(in srgb, var(--teal) 45%, var(--panel))', left: '72%', width: '28%' },
    mpaS1: { background: 'var(--faint)', left: 0, width: '10%' },
    mpaS3: {
      background:
        'linear-gradient(90deg, var(--teal), color-mix(in srgb, var(--teal) 45%, var(--panel)))',
      left: '10%',
      width: '90%',
    },
    marks: {
      color: 'var(--faint)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      gap: '0.6rem',
      justifyContent: 'space-between',
      letterSpacing: '0.04em',
      marginTop: '0.55rem',
    },
    warn: { color: 'var(--amber)' },
    usersNote: {
      color: 'var(--dim)',
      fontSize: '0.84rem',
      lineHeight: 1.6,
      marginTop: '1rem',
    },
    ledgerStrip: {
      alignItems: 'center',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--dim)',
      display: 'flex',
      flexWrap: 'wrap',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      gap: '1.6rem',
      letterSpacing: '0.05em',
      marginBottom: '3.4rem',
      padding: '0.85rem 1.3rem',
    },
    ledgerSep: { color: 'var(--edge)' },
    ledgerMore: {
      borderBottomColor: 'var(--teal)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontSize: '0.66rem',
      letterSpacing: '0.14em',
      marginLeft: 'auto',
      paddingBottom: '0.1rem',
      textTransform: 'uppercase',
    },
  },
  { namespace: 'site-landing', source: 'site/src/components/landing.tsx' },
);

export interface LandingPageProps {
  clients: ClientHrefs;
  loaderGzipBytes: number;
}

export function LandingRoutePage({ clients, loaderGzipBytes }: LandingPageProps): string {
  return (
    <div style={landingStyles.root}>
      {SiteHeader.definition.render({ activePath: '/', clients })}
      <div style={landingStyles.wrap}>
        <Hero clients={clients} />
        <BreakIt />
        <Split />
        <LedgerStrip loaderGzipBytes={loaderGzipBytes} />
      </div>
      {SiteFooter.definition.render()}
    </div>
  );
}

function Hero({ clients }: { clients: ClientHrefs }): string {
  return (
    <section style={landingStyles.hero}>
      <div>
        <h1 style={landingStyles.stencil}>
          {BRAND_CAPS}
          <span style={landingStyles.cursor}>&#9646;</span>
        </h1>
        <p style={landingStyles.tagline}>
          Builds like <em style={landingStyles.taglineEm}>React</em>. Runs like{' '}
          <em style={landingStyles.taglineEm}>HTML</em>.
        </p>
        <p style={landingStyles.sub}>
          {BRAND} is the web framework that <b style={landingStyles.strong}>hands your agent the
          fix</b> -- database to DOM. AI coding agents get a precise error and know exactly what to
          change, and your users get pages that are real HTML,{' '}
          <b style={landingStyles.strong}>interactive at first paint</b>.
        </p>
        <span style={landingStyles.noJs}>&#10003; No JS required on load</span>
        <div style={landingStyles.try}>
          <div style={landingStyles.cmd}>
            <span>
              <span style={landingStyles.dollar}>$</span>{' '}
              <code>pnpm create {BRAND_CLI} my-app</code>
            </span>
            <button
              type="button"
              style={landingStyles.copyButton}
              on:click={`${clients.code}#copy`}
            >
              copy
            </button>
          </div>
          <a style={[landingStyles.link, landingStyles.go]} href="/tutorial/">
            Start the tutorial
          </a>
        </div>
      </div>
      <div style={landingStyles.term}>
        <div style={landingStyles.termHead}>
          <span>one rename, every layer caught</span>
          <span>{BRAND_CLI} check</span>
        </div>
        <pre style={landingStyles.termPre}>
          <span style={landingStyles.textDim}>$ git diff db/schema.ts</span>
          {'\n'}
          <span style={landingStyles.textDel}>- price: integer('price'),</span>
          {'\n'}
          <span style={landingStyles.textAdd}>+ priceCents: integer('price_cents'),</span>
          {'\n\n'}
          <span style={landingStyles.textDim}>$ {BRAND_CLI} check</span>
          {'\n\n'}
          <span style={landingStyles.textErr}>&#10007;</span>{' '}
          <span style={landingStyles.textLoc}>server/queries/product.ts:14</span>{' '}
          <span style={[landingStyles.badge, landingStyles.badgeQuery]}>QUERY</span>
          {'\n  '}projection reads dropped column <b>price</b>
          {'\n  '}
          <span style={landingStyles.textFix}>
            -&gt; select priceCents, or alias: price: products.priceCents
          </span>
          {'\n\n'}
          <span style={landingStyles.textErr}>&#10007;</span>{' '}
          <span style={landingStyles.textLoc}>src/product-card.tsx:13</span>{' '}
          <span style={[landingStyles.badge, landingStyles.badgeBind]}>BINDING</span>
          {'\n  '}data-bind <b>"product.price"</b> has no source in the query
          {'\n  '}
          <span style={landingStyles.textFix}>
            -&gt; bind product.priceCents -- format in a derive
          </span>
          {'\n\n'}
          <span style={landingStyles.textErr}>&#10007;</span>{' '}
          <span style={landingStyles.textLoc}>src/cart/checkout.tsx:31</span>{' '}
          <span style={[landingStyles.badge, landingStyles.badgeForm]}>FORM</span>
          {'\n  '}field <b>price</b> is not in the cart/add mutation schema
          {'\n\n'}
          <span style={landingStyles.textErr}>&#10007;</span>{' '}
          <span style={landingStyles.textLoc}>src/routes/sale.ts:8</span>{' '}
          <span style={[landingStyles.badge, landingStyles.badgeRoute]}>ROUTE</span>
          {'\n  '}redirect builds <b>/sale?max=price</b> against a dropped param
          {'\n\n'}
          <div style={landingStyles.cascadeSum}>
            <span>
              <b style={landingStyles.strong}>4 errors</b> &middot; 4 files &middot; each with its
              fix
            </span>
            <span style={landingStyles.textOk}>0 guesses</span>
          </div>
        </pre>
      </div>
    </section>
  );
}

function BreakIt(): string {
  return (
    <section style={landingStyles.breakit}>
      <p style={landingStyles.sectionLabel}>How it works</p>
      <h2 style={landingStyles.pipeTitle}>Build-time checks from backend to frontend</h2>
      <p style={landingStyles.pipeSub}>
        Every layer below is checked against the next at build time. Don't take our word for it --
        break something:
      </p>

      <input type="radio" name="brk" id="brk-col" checked style={landingStyles.radio} />
      <input type="radio" name="brk" id="brk-query" style={landingStyles.radio} />
      <input type="radio" name="brk" id="brk-bind" style={landingStyles.radio} />

      <div style={landingStyles.choices}>
        <label for="brk-col" data-choice="col" style={landingStyles.choiceLabel}>
          <b style={landingStyles.choiceNumber}>01</b> rename the column
        </label>
        <label for="brk-query" data-choice="query" style={landingStyles.choiceLabel}>
          <b style={landingStyles.choiceNumber}>02</b> reshape the query
        </label>
        <label
          for="brk-bind"
          data-choice="bind"
          style={[landingStyles.choiceLabel, landingStyles.choiceLabelLast]}
        >
          <b style={landingStyles.choiceNumber}>03</b> typo the binding
        </label>
      </div>

      <div style={landingStyles.pipe}>
        <div style={landingStyles.node} data-node="database">
          <p style={landingStyles.nodeLabel}>Database</p>
          <pre style={landingStyles.nodePre}>
            products = <span style={landingStyles.textFn}>table</span>({'{'}
            {'\n  '}details: <span style={landingStyles.textHl}>nullable</span>(json),
            {'\n  '}price: <span style={landingStyles.textFn}>integer</span>()
            {'\n'}
            {'}'})
          </pre>
        </div>
        <div style={landingStyles.pipeLink} data-link="col">
          <span style={landingStyles.check} data-check="ok">
            &#10003; typed
          </span>
          <span style={[landingStyles.check, landingStyles.checkBad]} data-check="bad">
            &#10007; KV402
          </span>
          <span style={landingStyles.wire} data-wire></span>
        </div>
        <div style={landingStyles.node} data-node="query">
          <p style={landingStyles.nodeLabel}>Server query</p>
          <pre style={landingStyles.nodePre}>
            <span style={landingStyles.textFn}>query</span>(
            <span style={landingStyles.textSt}>'product'</span>, {'{'}
            {'\n  '}reads: [product],
            {'\n  '}load: ... <span style={landingStyles.textHl}>-&gt; shape</span>
            {'\n'}
            {'}'})
          </pre>
        </div>
        <div style={landingStyles.pipeLink} data-link="query">
          <span style={landingStyles.check} data-check="ok">
            &#10003; typed
          </span>
          <span style={[landingStyles.check, landingStyles.checkBad]} data-check="bad">
            &#10007; KV223
          </span>
          <span style={landingStyles.wire} data-wire></span>
        </div>
        <div style={landingStyles.node}>
          <p style={landingStyles.nodeLabel}>Client data</p>
          <pre style={landingStyles.nodePre}>
            &lt;script kovo-query=<span style={landingStyles.textSt}>"product"</span>&gt;
            {'\n'}
            {'{"price": '}
            <span style={landingStyles.textHl}>1299</span>
            {'}'}
          </pre>
        </div>
        <div style={landingStyles.pipeLink} data-link="bind">
          <span style={landingStyles.check} data-check="ok">
            &#10003; typed
          </span>
          <span style={[landingStyles.check, landingStyles.checkBad]} data-check="bad">
            &#10007; KV227
          </span>
          <span style={landingStyles.wire} data-wire></span>
        </div>
        <div style={landingStyles.node} data-node="ui">
          <p style={landingStyles.nodeLabel}>Rendered UI</p>
          <pre style={landingStyles.nodePre}>
            &lt;h2 data-bind=
            {'\n  '}
            <span style={landingStyles.textSt}>"product.price"</span>&gt;
          </pre>
        </div>
      </div>

      <div style={landingStyles.caught}>
        <CaughtCase
          kind="col"
          head={`${BRAND_CLI} check -- caught at the database -> query junction`}
          code="KV402"
          title="query 'product' reads a column that no longer exists"
          location="server/queries/product.ts:14 -- select(products."
          field="price"
          fix="-> the column is now priceCents -- select it, or alias: price: products.priceCents"
          note="every query is compiled against the live schema, so a rename can't reach production"
        />
        <CaughtCase
          kind="query"
          head={`${BRAND_CLI} check -- caught at the query -> client junction`}
          code="KV223"
          title="the page depends on data the query no longer ships"
          location='src/product-card.tsx:13 -- data-bind="product.'
          field="price"
          fix="-> the projection now ships priceCents -- update the binding, or restore the field"
          note="bindings are typed against the query's emitted shape, not against hope"
        />
        <CaughtCase
          kind="bind"
          head={`${BRAND_CLI} check -- caught at the client -> UI junction`}
          code="KV227"
          title="binding path 'product.pricee' does not exist"
          location='src/product-card.tsx:13 -- data-bind="product.'
          field="pricee"
          fix="-> did you mean product.price?"
          note="the DOM is part of the type system: a typo in an attribute is a build error"
        />
      </div>
      <p style={landingStyles.breakitFoot}>
        <span>
          this demo is plain HTML and CSS -- radio buttons and :has().{' '}
          <b style={landingStyles.breakitFootStrong}>that's the point.</b>
        </span>
        <span>L0 on the interaction ladder</span>
      </p>
    </section>
  );
}

function CaughtCase({
  code,
  field,
  fix,
  head,
  kind,
  location,
  note,
  title,
}: {
  code: string;
  field: string;
  fix: string;
  head: string;
  kind: 'col' | 'query' | 'bind';
  location: string;
  note: string;
  title: string;
}): string {
  return (
    <div
      style={[landingStyles.term, landingStyles.caughtTerm, landingStyles.casePanel]}
      data-case={kind}
    >
      <div style={landingStyles.termHead}>
        <span>{head}</span>
      </div>
      <pre style={landingStyles.termPre}>
        <span style={landingStyles.textErr}>&#10007; {code}</span> -- <b>{title}</b>
        {'\n\n  '}
        {location}
        <span style={landingStyles.squiggle}>{field}</span>
        {field === 'price' ? ')' : '"'}
        {'\n  '}
        <span style={landingStyles.textFix}>{fix}</span>
        {'\n  '}
        <span style={landingStyles.textDim}>{note}</span>
      </pre>
    </div>
  );
}

function Split(): string {
  return (
    <section style={landingStyles.split}>
      <div style={landingStyles.half}>
        <p style={[landingStyles.halfLabel, landingStyles.agentLabel]}>For agents</p>
        <h3 style={landingStyles.halfTitle}>Errors worth reading</h3>
        <p style={landingStyles.lead}>
          Every diagnostic teaches: the line, the reason, the fixes -- so the loop is{' '}
          <b style={landingStyles.strong}>edit -&gt; check -&gt; fixed</b>, not edit -&gt; deploy
          -&gt; bug report. The behavior graph is queryable too:{' '}
          <code style={landingStyles.leadCode}>{BRAND_CLI} explain mutation cart/add</code> answers
          "what refreshes?" with diffable output for CI.
        </p>
        <div style={landingStyles.term}>
          <div style={landingStyles.termHead}>$ {BRAND_CLI} check</div>
          <pre style={landingStyles.termPre}>
            <span style={landingStyles.textDim}>13 &#9474;</span> render: () =&gt; &lt;h2&gt;{'{'}
            product.
            <span style={landingStyles.squiggle}>details.name</span>
            {'}'}&lt;/h2&gt;
            {'\n\n'}
            <span style={landingStyles.textErr}>&#10007; KV227</span> --{' '}
            <b>product.details can be null here</b>
            {'\n  '}
            <span style={landingStyles.textFix}>fix 1</span> {'{'}product.details
            <span style={landingStyles.textOk}>?.</span>name{'}'}
            {'\n  '}
            <span style={landingStyles.textFix}>fix 2</span> make the projection non-null in the
            query
            {'\n\n'}
            <span style={landingStyles.textOk}>&#10003; caught in 0.4s -- before anything ran</span>
          </pre>
        </div>
      </div>

      <div style={[landingStyles.half, landingStyles.rightHalf]}>
        <p style={[landingStyles.halfLabel, landingStyles.userLabel]}>For users</p>
        <h3 style={landingStyles.halfTitle}>No uncanny valley</h3>
        <p style={landingStyles.lead}>
          No hydration means no window where the page{' '}
          <b style={landingStyles.strong}>looks ready but isn't</b>. A button works the moment it
          paints.
        </p>
        <div style={landingStyles.timelines}>
          <div style={landingStyles.timeline}>
            <p style={landingStyles.who}>
              <span>Typical SPA</span>
              <span style={landingStyles.bad}>interactive at 3.2s</span>
            </p>
            <div style={landingStyles.track}>
              <span style={[landingStyles.segment, landingStyles.spaS1]}></span>
              <span style={[landingStyles.segment, landingStyles.spaS2]}></span>
              <span style={[landingStyles.segment, landingStyles.spaS3]}></span>
            </div>
            <p style={landingStyles.marks}>
              <span>0ms paint</span>
              <span style={landingStyles.warn}>&#9888; looks ready, ignores clicks</span>
              <span>3.2s</span>
            </p>
          </div>
          <div style={landingStyles.timeline}>
            <p style={landingStyles.who}>
              <span>{BRAND}</span>
              <span style={landingStyles.good}>interactive at first paint</span>
            </p>
            <div style={landingStyles.track}>
              <span style={[landingStyles.segment, landingStyles.mpaS1]}></span>
              <span style={[landingStyles.segment, landingStyles.mpaS3]}></span>
            </div>
            <p style={landingStyles.marks}>
              <span>0ms paint</span>
              <span style={landingStyles.textOk}>
                &#10003; every click works -- tiny loader, handlers on demand
              </span>
            </p>
          </div>
        </div>
        <p style={landingStyles.usersNote}>
          With JavaScript off, every page still renders and every form still posts.{' '}
          <b style={landingStyles.strong}>This site runs on {BRAND} -- try it.</b>
        </p>
      </div>
    </section>
  );
}

function LedgerStrip({ loaderGzipBytes }: { loaderGzipBytes: number }): string {
  return (
    <p style={landingStyles.ledgerStrip}>
      <span>
        <span style={landingStyles.textOk}>&#9679;</span> all build gates green
      </span>
      <span style={landingStyles.ledgerSep}>&#9474;</span>
      <span>
        loader <b style={landingStyles.strong}>{loaderGzipBytes.toLocaleString('en-US')} B</b> gzip
        -- measured this build
      </span>
      <span style={landingStyles.ledgerSep}>&#9474;</span>
      <span>TTI = first paint</span>
      <span style={landingStyles.ledgerSep}>&#9474;</span>
      <span>JS-off: every page</span>
      <span style={landingStyles.ledgerSep}>&#9474;</span>
      <span>fixpoint compile</span>
      <a style={[landingStyles.link, landingStyles.ledgerMore]} href="/guides/testing/">
        see how it's verified -&gt;
      </a>
    </p>
  );
}
