/** @jsxImportSource @kovojs/server */
import * as style from '@kovojs/style';

import { SiteFooter, SiteHeader, type ClientHrefs } from './chrome.js';

// Landing page (SPEC §7 L0): authored as TSX route composition so the route
// compiler can derive enhanced-navigation page boundaries. Interactions are
// zero-JS by construction — the hero's stale-UI demo is a CSS keyframe loop and
// the auto-invalidation section's mobile tabs are radio + :has() — so the page
// is interactive at first paint with no JavaScript required on load.
//
// The header and footer are the shared site chrome (SiteHeader/SiteFooter from
// chrome.tsx). The visual system is "The Proof" (see DESIGN.md): all colors flow
// from the global design tokens (--bg/--ink/--accent/… in styles.css), so the
// page reads correctly in both light and dark themes; code and terminal frames
// stay near-black in both as evidence.

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
  },
  { namespace: 'site-landing', source: 'site/src/components/landing.tsx' },
);

// The Proof hero (DESIGN.md signature component): the stale-UI story as a
// zero-JS CSS auto-loop. Base styles render the consistent end-state, and the
// @keyframes in styles.css (hero-*) animate the 15s loop; prefers-reduced-motion
// freezes to that consistent state via [data-anim="hero"].
const heroStyles = style.create(
  {
    hero: {
      alignItems: 'center',
      display: 'grid',
      gap: '3.6rem',
      gridTemplateColumns: 'minmax(0, 1.02fr) minmax(0, 1.08fr)',
      padding: '4rem 0 3.6rem',
      '@media (max-width: 64rem)': {
        gap: '2.4rem',
        gridTemplateColumns: '1fr',
        padding: '2.8rem 0 2.6rem',
      },
    },
    h1: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: 'clamp(2.7rem, 5.4vw, 4.4rem)',
      fontWeight: 600,
      letterSpacing: '-0.025em',
      lineHeight: 1.02,
      margin: 0,
      textWrap: 'balance',
    },
    bugPhrase: {
      color: 'var(--red)',
      fontStyle: 'italic',
      fontWeight: 600,
      textDecorationColor: 'color-mix(in srgb, var(--red) 70%, transparent)',
      textDecorationLine: 'underline',
      textDecorationStyle: 'wavy',
      textDecorationThickness: '0.08em',
      textUnderlineOffset: '0.12em',
    },
    buildPhrase: {
      background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
      borderBottom: '0.1em solid var(--accent)',
      boxDecorationBreak: 'clone',
      color: 'var(--accent)',
      fontStyle: 'normal',
      fontWeight: 650,
      padding: '0 0.06em',
      WebkitBoxDecorationBreak: 'clone',
    },
    lede: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: 'clamp(1.2rem, 2vw, 1.55rem)',
      fontWeight: 380,
      lineHeight: 1.34,
      margin: '1.5rem 0 0',
      maxWidth: '33rem',
    },
    sub: {
      color: 'var(--dim)',
      fontSize: '1rem',
      lineHeight: 1.62,
      margin: '1.1rem 0 0',
      maxWidth: '32rem',
    },
    strong: { color: 'var(--ink)', fontWeight: 600 },
    cta: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1.1rem',
      marginTop: '1.9rem',
    },
    unit: {
      background: 'var(--card)',
      borderColor: 'var(--green)',
      borderStyle: 'solid',
      borderWidth: 1,
      overflow: 'hidden',
      animation: 'hero-unit 15s linear infinite',
    },
    acts: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    },
    actA: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.45rem',
      opacity: 0.38,
      padding: '0.6rem 0.85rem',
      animation: 'hero-acta 15s linear infinite',
    },
    actB: {
      background: 'color-mix(in srgb, var(--accent) 6%, var(--card))',
      display: 'flex',
      flex: 1,
      flexDirection: 'column',
      gap: '0.45rem',
      padding: '0.6rem 0.85rem',
      animation: 'hero-actb 15s linear infinite',
    },
    actLabA: { color: 'var(--ink)', fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.03em' },
    actLabB: {
      alignItems: 'center',
      color: 'var(--accent)',
      display: 'flex',
      fontSize: '0.76rem',
      fontWeight: 700,
      gap: '0.45rem',
      letterSpacing: '0.03em',
    },
    diamond: { background: 'var(--accent)', height: 8, transform: 'rotate(45deg)', width: 8 },
    beats: { display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginTop: '0.1rem' },
    beat: {
      alignItems: 'center',
      color: 'var(--faint)',
      display: 'flex',
      fontSize: '0.62rem',
      fontWeight: 500,
      gap: '0.35rem',
    },
    seam: {
      alignItems: 'center',
      borderLeftColor: 'var(--accent)',
      borderLeftStyle: 'dashed',
      borderLeftWidth: 1,
      borderRightColor: 'var(--accent)',
      borderRightStyle: 'dashed',
      borderRightWidth: 1,
      color: 'var(--accent)',
      display: 'flex',
      fontSize: '0.52rem',
      lineHeight: 1.2,
      padding: '0 0.7rem',
      textAlign: 'center',
      whiteSpace: 'nowrap',
    },
    shopbar: {
      alignItems: 'center',
      background: 'var(--panel)',
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.7rem 1rem',
    },
    brand: { fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600 },
    pill: {
      alignItems: 'center',
      background: 'var(--synced-bg)',
      borderColor: 'var(--green)',
      borderStyle: 'solid',
      borderWidth: 1,
      color: 'var(--green)',
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.8rem',
      gap: '0.45rem',
      padding: '0.28rem 0.62rem',
      animation: 'hero-pill 15s linear infinite',
    },
    badgeWrap: { display: 'inline-block', fontWeight: 700, position: 'relative' },
    badge2: { animation: 'hero-badge2 15s linear infinite', opacity: 0 },
    badge3: {
      animation: 'hero-badge3 15s linear infinite',
      left: 0,
      opacity: 1,
      position: 'absolute',
      top: 0,
    },
    shopbody: {
      display: 'grid',
      gridTemplateColumns: '1.15fr 1fr',
      '@media (max-width: 30rem)': { gridTemplateColumns: '1fr' },
    },
    prod: { padding: '1.1rem', position: 'relative' },
    prodNm: { fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600 },
    prodPr: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.82rem',
      margin: '0.2rem 0 0.9rem',
    },
    addBtn: {
      background: 'var(--ink)',
      border: 'none',
      color: 'var(--bg)',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.06em',
      padding: '0.55rem 0.9rem',
      position: 'relative',
      textTransform: 'uppercase',
      animation: 'hero-press 15s ease infinite',
    },
    lblWrap: { display: 'inline-block', position: 'relative' },
    lbl1: { animation: 'hero-lbl1 15s linear infinite', opacity: 0 },
    lbl2: {
      animation: 'hero-lbl2 15s linear infinite',
      left: 0,
      opacity: 1,
      position: 'absolute',
      top: 0,
      whiteSpace: 'nowrap',
    },
    ring: {
      borderColor: 'var(--accent)',
      borderRadius: 9999,
      borderStyle: 'solid',
      borderWidth: 2,
      height: 54,
      left: '2.4rem',
      marginLeft: -27,
      marginTop: -27,
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
      top: '5.5rem',
      width: 54,
      animation: 'hero-ring 15s linear infinite',
    },
    ring2: { borderColor: 'var(--accent-soft)', animation: 'hero-ring2 15s linear infinite' },
    cursor: {
      height: 34,
      left: '1.9rem',
      opacity: 0,
      pointerEvents: 'none',
      position: 'absolute',
      top: '5rem',
      transform: 'translate(0, 0)',
      width: 34,
      zIndex: 4,
      animation: 'hero-cursor 15s cubic-bezier(0.33, 1, 0.68, 1) infinite',
    },
    cursorPath: { fill: 'var(--ink)', stroke: 'var(--card)' },
    mini: {
      borderLeftColor: 'var(--edge-soft)',
      borderLeftStyle: 'solid',
      borderLeftWidth: 1,
      padding: '1.1rem',
      '@media (max-width: 30rem)': {
        borderLeftWidth: 0,
        borderTopColor: 'var(--edge-soft)',
        borderTopStyle: 'solid',
        borderTopWidth: 1,
      },
    },
    miniH: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      letterSpacing: '0.16em',
      margin: '0 0 0.7rem',
      textTransform: 'uppercase',
    },
    mline: {
      color: 'var(--dim)',
      display: 'flex',
      fontSize: '0.85rem',
      justifyContent: 'space-between',
      marginBottom: '0.4rem',
    },
    mlineB: { color: 'var(--ink)' },
    mtot: {
      borderTopColor: 'var(--edge-soft)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.85rem',
      justifyContent: 'space-between',
      marginTop: '0.55rem',
      paddingTop: '0.55rem',
    },
    swap: { display: 'inline-block', position: 'relative' },
    tick: { animation: 'hero-tick 15s ease infinite' },
    num2: { animation: 'hero-cart2 15s linear infinite', opacity: 0 },
    num3: {
      animation: 'hero-cart3 15s linear infinite',
      left: 0,
      opacity: 1,
      position: 'absolute',
      top: 0,
    },
    verdict: {
      alignItems: 'flex-start',
      background: 'var(--synced-bg)',
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.76rem',
      gap: '0.7rem',
      lineHeight: 1.5,
      minHeight: '4.7rem',
      padding: '0.85rem 0.95rem',
      animation: 'hero-vtint 15s linear infinite',
    },
    vMark: {
      background: 'var(--green)',
      color: '#fff',
      flexGrow: 0,
      flexShrink: 0,
      fontWeight: 700,
      height: '1.35rem',
      marginTop: '0.05rem',
      position: 'relative',
      width: '1.35rem',
      animation: 'hero-vmark 15s linear infinite',
    },
    vGlyph: {
      alignItems: 'center',
      bottom: 0,
      display: 'flex',
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    vBody: { color: 'var(--ink)', flex: 1, minHeight: '3rem', position: 'relative' },
    vLine: { left: 0, position: 'absolute', right: 0, top: 0 },
    vFix: { color: 'var(--accent)', display: 'block', marginTop: '0.3rem' },
    vg0: { animation: 'hero-v0 15s linear infinite', opacity: 0 },
    vg1: { animation: 'hero-v1 15s linear infinite', opacity: 0 },
    vg2: { animation: 'hero-v2 15s linear infinite', opacity: 0 },
    vg3: { animation: 'hero-v3 15s linear infinite', opacity: 0 },
    vg4: { animation: 'hero-v4 15s linear infinite', opacity: 1 },
  },
  { namespace: 'site-hero', source: 'site/src/components/landing.tsx' },
);

// Security hero (Bobby Tables SQL injection). Shares the hero unit / two-act
// header / verdict and several hero-* keyframes; only the form, table, and the
// security-tinted verdict are new. Base styles render the safe end-state.
const secStyles = style.create(
  {
    formBlock: { padding: '1.1rem 1.1rem 0.6rem' },
    formLabel: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      letterSpacing: '0.16em',
      margin: '0 0 0.5rem',
      textTransform: 'uppercase',
    },
    field: {
      alignItems: 'center',
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.82rem',
      minHeight: '2.4rem',
      padding: '0.55rem 0.7rem',
      animation: 'sec-field 15s linear infinite',
    },
    typed: {
      color: 'var(--stale)',
      opacity: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      animation: 'sec-typed 15s linear infinite',
    },
    tableBlock: { padding: '0.6rem 1.1rem 1.1rem' },
    tlabel: {
      color: 'var(--faint)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      justifyContent: 'space-between',
      letterSpacing: '0.16em',
      margin: '0 0 0.5rem',
      textTransform: 'uppercase',
    },
    tstate: { display: 'inline-block', minWidth: '8rem', position: 'relative', textAlign: 'right' },
    tsline: { position: 'absolute', right: 0, top: 0, whiteSpace: 'nowrap' },
    tsBad: { color: 'var(--stale)' },
    tsAccent: { color: 'var(--accent)' },
    tsGood: { color: 'var(--synced)' },
    table: {
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      animation: 'sec-table 15s linear infinite',
    },
    thead: {
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--faint)',
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.4rem 0.7rem',
    },
    trow: {
      borderBottomColor: 'var(--edge-soft)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.4rem 0.7rem',
      animation: 'sec-rows 15s linear infinite',
    },
    trowLast: { borderBottomWidth: 0 },
    verdict: {
      alignItems: 'flex-start',
      background: 'var(--synced-bg)',
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.76rem',
      gap: '0.7rem',
      lineHeight: 1.5,
      minHeight: '4.6rem',
      padding: '0.85rem 0.95rem',
      animation: 'sec-vtint 15s linear infinite',
    },
    vMark: {
      background: 'var(--synced)',
      color: '#fff',
      flexGrow: 0,
      flexShrink: 0,
      fontWeight: 700,
      height: '1.35rem',
      marginTop: '0.05rem',
      position: 'relative',
      width: '1.35rem',
      animation: 'sec-vmark 15s linear infinite',
    },
  },
  { namespace: 'site-sec', source: 'site/src/components/landing.tsx' },
);

export interface LandingPageProps {
  clients: ClientHrefs;
}

export function LandingRoutePage({ clients }: LandingPageProps): string {
  return (
    <div style={landingStyles.root}>
      {SiteHeader.definition.render({ activePath: '/', clients })}
      <div style={landingStyles.wrap}>
        <SecurityHero clients={clients} />
        <StaleUiSection />
        <InstantLoad />
        <Credibility />
      </div>
      {SiteFooter.definition.render()}
    </div>
  );
}

function SecurityHero({ clients }: { clients: ClientHrefs }): string {
  return (
    <section style={heroStyles.hero}>
      <div>
        <h1 style={heroStyles.h1}>
          The web framework that turns <em style={heroStyles.bugPhrase}>security bugs</em> into{' '}
          <em style={heroStyles.buildPhrase}>build errors</em>
        </h1>
        <p style={heroStyles.lede}>Make security holes a build error -- not a 2AM incident.</p>
        <p style={heroStyles.sub}>
          The Kovo compiler catches the most common security vulnerabilities --{' '}
          <b style={heroStyles.strong}>SQL injection</b>, <b style={heroStyles.strong}>XSS</b>,{' '}
          <b style={heroStyles.strong}>CSRF</b>, <b style={heroStyles.strong}>IDOR</b> -- as soon as
          your coding agent writes them.
        </p>
        <div style={heroStyles.cta}>
          <div style={landingStyles.cmd}>
            <span>
              <span style={landingStyles.dollar}>$</span> <code>npx create-kovo</code>
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
      <div data-anim="hero" style={heroStyles.unit}>
        <SecActs />
        <SecForm />
        <SecTable />
        <SecVerdict />
      </div>
    </section>
  );
}

function SecActs(): string {
  return (
    <div style={heroStyles.acts}>
      <div style={heroStyles.actA}>
        <span style={heroStyles.actLabA}>Every other framework</span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>attacker submits</span>
          <span style={heroStyles.beat}>SQL runs</span>
          <span style={heroStyles.beat}>dropped &#10007;</span>
        </div>
      </div>
      <div style={heroStyles.seam}>
        kovo
        <br />
        check
      </div>
      <div style={heroStyles.actB}>
        <span style={heroStyles.actLabB}>
          <span style={heroStyles.diamond}></span>What Kovo adds
        </span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>caught at build</span>
          <span style={heroStyles.beat}>harmless &#10003;</span>
        </div>
      </div>
    </div>
  );
}

function SecForm(): string {
  return (
    <div style={secStyles.formBlock}>
      <p style={secStyles.formLabel}>Sign up &middot; name</p>
      <div style={secStyles.field}>
        <span style={secStyles.typed}>Robert&apos;); DROP TABLE users;--</span>
      </div>
    </div>
  );
}

function SecTable(): string {
  return (
    <div style={secStyles.tableBlock}>
      <p style={secStyles.tlabel}>
        <span>users</span>
        <span style={secStyles.tstate}>
          <span style={[secStyles.tsline, heroStyles.vg0]}>3 rows</span>
          <span style={[secStyles.tsline, heroStyles.vg1]}>3 rows</span>
          <span style={[secStyles.tsline, heroStyles.vg2, secStyles.tsBad]}>&#10007; dropped</span>
          <span style={[secStyles.tsline, heroStyles.vg3, secStyles.tsAccent]}>
            caught at build
          </span>
          <span style={[secStyles.tsline, heroStyles.vg4, secStyles.tsGood]}>&#10003; intact</span>
        </span>
      </p>
      <div style={secStyles.table}>
        <div style={secStyles.thead}>
          <span>id</span>
          <span>name</span>
        </div>
        <div style={secStyles.trow}>
          <span>1</span>
          <span>ada</span>
        </div>
        <div style={secStyles.trow}>
          <span>2</span>
          <span>grace</span>
        </div>
        <div style={[secStyles.trow, secStyles.trowLast]}>
          <span>3</span>
          <span>linus</span>
        </div>
      </div>
    </div>
  );
}

function SecVerdict(): string {
  return (
    <div style={secStyles.verdict}>
      <span style={secStyles.vMark}>
        <span style={[heroStyles.vGlyph, heroStyles.vg0]}>&middot;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg1]}>&middot;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg2]}>&#10007;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg3]}>!</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg4]}>&#10003;</span>
      </span>
      <span style={heroStyles.vBody}>
        <span style={[heroStyles.vLine, heroStyles.vg0]}>
          Three users. A sign-up form that stores your name.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg1]}>
          An attacker submits a name that is really SQL.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg2, secStyles.tsBad]}>
          &#10007; the string executes -- <b>DROP TABLE users.</b> Everyone is gone.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg3]}>
          &#10007; KV431 -- a build error in Kovo. The query never shipped.
          <span style={heroStyles.vFix}>
            -&gt; parameterized: where(eq(users.name, input.name))
          </span>
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg4, secStyles.tsGood]}>
          &#10003; the input is bound as a value -- stored as a name, no SQL run.
        </span>
      </span>
    </div>
  );
}

function StaleUiSection(): string {
  return (
    <section style={pageStyles.section}>
      <div style={[pageStyles.instGrid, pageStyles.alignStart]}>
        <div>
          <p style={pageStyles.eyebrow}>No stale UI</p>
          <h2 style={pageStyles.title}>Your UI can&apos;t disagree with itself.</h2>
          <p style={pageStyles.lead}>
            Add to cart, and every view of the cart agrees by construction. Kovo owns the path from
            the database to the DOM, so a view that could drift out of date is a compile error, not
            a bug your users find later.
          </p>
          <p style={pageStyles.lead}>
            And nothing is wired by hand: declare what a view reads, and the compiler invalidates
            exactly the views a mutation touches -- no cache tags, no{' '}
            <span style={pageStyles.leadCode}>invalidateQueries</span>, no{' '}
            <span style={pageStyles.leadCode}>useEffect</span>.
          </p>
        </div>
        <div data-anim="hero" style={heroStyles.unit}>
          <HeroActs />
          <HeroShop />
          <HeroVerdict />
        </div>
      </div>
      <div style={pageStyles.aiUnit}>
        <input type="radio" name="ai-tab" id="ai-other" checked style={pageStyles.radioTab} />
        <input type="radio" name="ai-tab" id="ai-kovo" style={pageStyles.radioTab} />
        <div style={pageStyles.aiTabs}>
          <label for="ai-other" data-aitab="other" style={pageStyles.aiTab}>
            <span style={pageStyles.markBad}>&#10007;</span> Other frameworks
          </label>
          <label for="ai-kovo" data-aitab="kovo" style={[pageStyles.aiTab, pageStyles.aiTabDiv]}>
            <span style={pageStyles.markAccent}>&#10003;</span> In Kovo
          </label>
        </div>
        <div style={pageStyles.aiCol} data-aicol="other">
          <div style={[pageStyles.aiHead, pageStyles.aiHeadBad]}>
            <span style={pageStyles.aiHeadLabel}>&#10007; Other frameworks</span>
            <span style={pageStyles.aiHeadFile}>cart.ts</span>
          </div>
          <pre style={[pageStyles.code, pageStyles.grow]}>
            <span style={pageStyles.cKw}>async function</span> addToCart(item) {'{'}
            {'\n  '}
            <span style={pageStyles.cKw}>await</span> db.cart.add(item)
            {'\n\n  '}
            <span style={pageStyles.cDim}>// remember every view that reads cart:</span>
            {'\n  '}
            <span style={pageStyles.cFn}>invalidate</span>(
            <span style={pageStyles.cStr}>&apos;cart&apos;</span>){'\n  '}
            <span style={pageStyles.cFn}>invalidate</span>(
            <span style={pageStyles.cStr}>&apos;cart-badge&apos;</span>){'\n  '}
            <span style={pageStyles.cFn}>invalidate</span>(
            <span style={pageStyles.cStr}>&apos;free-shipping&apos;</span>){'\n  '}
            <span style={pageStyles.bad}>// miss one and it silently goes stale.</span>
            {'\n'}
            {'}'}
          </pre>
          <div style={pageStyles.aiVerdict}>
            Forget one <span style={pageStyles.mono}>invalidate(...)</span> and you ship the{' '}
            <span style={pageStyles.bad}>stale bug</span> -- the badge that disagrees with the cart.
          </div>
        </div>
        <div style={[pageStyles.aiCol, pageStyles.aiColRight]} data-aicol="kovo">
          <div style={[pageStyles.aiHead, pageStyles.aiHeadGood]}>
            <span style={pageStyles.aiHeadLabel}>&#10003; In Kovo</span>
            <span style={pageStyles.aiHeadFile}>cart.ts</span>
          </div>
          <pre style={[pageStyles.code, pageStyles.grow]}>
            <span style={pageStyles.cDim}>// a view reads what it needs:</span>
            {'\n'}
            <span style={pageStyles.cKw}>const</span> total ={' '}
            <span style={pageStyles.cBind}>cart.total</span>
            {'\n\n'}
            <span style={pageStyles.cDim}>// the mutation only writes:</span>
            {'\n'}
            <span style={pageStyles.cFn}>mutation</span>(
            <span style={pageStyles.cStr}>&apos;cart/add&apos;</span>, (item) =&gt;
            {'\n  '}db.cart.add(item))
            {'\n\n'}
            <span style={pageStyles.good}>// every view that reads cart refreshes.</span>
            {'\n'}
            <span style={pageStyles.cDim}>// nothing to invalidate. checked at build.</span>
          </pre>
          <div style={pageStyles.aiVerdict}>
            The read set <span style={pageStyles.good}>is</span> the invalidation set. Add a view
            and it is already wired -- diffable in CI.
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroActs(): string {
  return (
    <div style={heroStyles.acts}>
      <div style={heroStyles.actA}>
        <span style={heroStyles.actLabA}>Every other framework</span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>idle</span>
          <span style={heroStyles.beat}>add to cart</span>
          <span style={heroStyles.beat}>stale, shipped &#10007;</span>
        </div>
      </div>
      <div style={heroStyles.seam}>
        kovo
        <br />
        check
      </div>
      <div style={heroStyles.actB}>
        <span style={heroStyles.actLabB}>
          <span style={heroStyles.diamond}></span>What Kovo adds
        </span>
        <div style={heroStyles.beats}>
          <span style={heroStyles.beat}>caught</span>
          <span style={heroStyles.beat}>consistent &#10003;</span>
        </div>
      </div>
    </div>
  );
}

function NumberSwap({ two, three }: { two: string; three: string }): string {
  return (
    <span style={heroStyles.swap}>
      <span style={heroStyles.num2}>{two}</span>
      <span style={heroStyles.num3}>{three}</span>
    </span>
  );
}

function HeroShop(): string {
  return (
    <div>
      <div style={heroStyles.shopbar}>
        <span style={heroStyles.brand}>Northwind</span>
        <span style={heroStyles.pill}>
          cart{' '}
          <b style={heroStyles.badgeWrap}>
            <span style={heroStyles.badge2}>2</span>
            <span style={heroStyles.badge3}>3</span>
          </b>
        </span>
      </div>
      <div style={heroStyles.shopbody}>
        <div style={heroStyles.prod}>
          <div style={heroStyles.prodNm}>Aeron Chair</div>
          <div style={heroStyles.prodPr}>$48.00</div>
          <button type="button" style={heroStyles.addBtn}>
            <span style={heroStyles.lblWrap}>
              <span style={heroStyles.lbl1}>add to cart</span>
              <span style={heroStyles.lbl2}>&#10003; added</span>
            </span>
          </button>
          <span style={heroStyles.ring}></span>
          <span style={[heroStyles.ring, heroStyles.ring2]}></span>
          <span style={heroStyles.cursor}>
            <svg viewBox="0 0 32 32" width="34" height="34">
              <path
                d="M7 3.5l19 10.5-8.1 1.7-3.5 8.3z"
                style={heroStyles.cursorPath}
                stroke-width="1.7"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
        <div style={heroStyles.mini}>
          <p style={heroStyles.miniH}>Your cart</p>
          <div style={heroStyles.mline}>
            <span>Items</span>
            <b style={[heroStyles.mlineB, heroStyles.tick]}>
              <NumberSwap two="2" three="3" />
            </b>
          </div>
          <div style={heroStyles.mline}>
            <span>Aeron Chair</span>
            <span>
              &times;
              <NumberSwap two="2" three="3" />
            </span>
          </div>
          <div style={heroStyles.mtot}>
            <span>Subtotal</span>
            <b style={heroStyles.mlineB}>
              <NumberSwap two="$96" three="$144" />
            </b>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroVerdict(): string {
  return (
    <div style={heroStyles.verdict}>
      <span style={heroStyles.vMark}>
        <span style={[heroStyles.vGlyph, heroStyles.vg0]}>&#10003;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg1]}>+</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg2]}>&#10007;</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg3]}>!</span>
        <span style={[heroStyles.vGlyph, heroStyles.vg4]}>&#10003;</span>
      </span>
      <span style={heroStyles.vBody}>
        <span style={[heroStyles.vLine, heroStyles.vg0]}>Two views of one cart, in agreement.</span>
        <span style={[heroStyles.vLine, heroStyles.vg1]}>
          Added 1 to the cart, refreshing the views...
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg2]}>
          Header shows 2, cart shows 3 -- the stale UI most frameworks ship.
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg3]}>
          KV251 -- cart/add updates items, but the header reads cart.count and isn't in its touch
          set.
          <span style={heroStyles.vFix}>-&gt; add cart.count to the cart/add touch set</span>
        </span>
        <span style={[heroStyles.vLine, heroStyles.vg4]}>
          kovo check passed -- the header, cart, and subtotal are one fact.
        </span>
      </span>
    </div>
  );
}

// ── Landing content sections (The Proof, DESIGN.md) ──────────────────────────
const pageStyles = style.create(
  {
    section: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      padding: '4.2rem 0',
    },
    eyebrow: {
      color: 'var(--accent)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.7rem',
      letterSpacing: '0.18em',
      margin: '0 0 0.9rem',
      textTransform: 'uppercase',
    },
    title: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: 'clamp(1.9rem, 3.4vw, 2.55rem)',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      lineHeight: 1.08,
      margin: 0,
      maxWidth: '22ch',
      textWrap: 'balance',
    },
    lead: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-serif)',
      fontSize: 'clamp(1.1rem, 1.7vw, 1.3rem)',
      fontWeight: 380,
      lineHeight: 1.45,
      margin: '1rem 0 0',
      maxWidth: '46rem',
    },
    alignStart: { alignItems: 'start' },
    leadCode: { color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
    aiUnit: {
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      margin: '2.4rem 0 0',
      position: 'relative',
      // The two-column layout is set ONLY in a min-width media (no base value),
      // so narrow viewports default to a single column. Overriding a base
      // grid-template-columns from a media query is order-fragile in the atomic
      // compiler, so we avoid the conflict entirely. On mobile the tab bar shows
      // and :has() reveals only the selected column (radio + :has(), zero JS).
      '@media (min-width: 52.01rem)': { gridTemplateColumns: '1fr 1fr' },
      ':has(#ai-other:checked) [data-aicol="kovo"]': {
        '@media (max-width: 52rem)': { display: 'none' },
      },
      ':has(#ai-kovo:checked) [data-aicol="other"]': {
        '@media (max-width: 52rem)': { display: 'none' },
      },
      ':has(#ai-other:checked) [data-aitab="other"]': {
        '@media (max-width: 52rem)': { background: 'var(--card)', color: 'var(--ink)' },
      },
      ':has(#ai-kovo:checked) [data-aitab="kovo"]': {
        '@media (max-width: 52rem)': { background: 'var(--card)', color: 'var(--ink)' },
      },
    },
    radioTab: { height: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', width: 0 },
    aiTabs: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      '@media (max-width: 52rem)': { display: 'flex' },
      '@media (min-width: 52.01rem)': { display: 'none' },
    },
    aiTab: {
      alignItems: 'center',
      background: 'var(--panel)',
      color: 'var(--dim)',
      cursor: 'pointer',
      display: 'flex',
      flex: 1,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.74rem',
      fontWeight: 700,
      gap: '0.45rem',
      justifyContent: 'center',
      letterSpacing: '0.03em',
      padding: '0.7rem 1rem',
      textTransform: 'uppercase',
    },
    aiTabDiv: { borderLeftColor: 'var(--edge)', borderLeftStyle: 'solid', borderLeftWidth: 1 },
    aiHead: {
      alignItems: 'center',
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      fontWeight: 700,
      justifyContent: 'space-between',
      letterSpacing: '0.04em',
      padding: '0.7rem 1rem',
      textTransform: 'uppercase',
    },
    aiHeadBad: {
      background: 'color-mix(in srgb, var(--red) 9%, var(--card))',
      color: 'var(--red)',
    },
    aiHeadGood: {
      background: 'color-mix(in srgb, var(--accent) 9%, var(--card))',
      color: 'var(--accent)',
    },
    aiHeadLabel: { alignItems: 'center', display: 'flex', gap: '0.5rem' },
    aiHeadFile: { color: 'var(--faint)', fontWeight: 400, letterSpacing: '0.1em' },
    markBad: { color: 'var(--red)' },
    markAccent: { color: 'var(--accent)' },
    aiCol: { display: 'flex', flexDirection: 'column' },
    aiColRight: {
      '@media (min-width: 52.01rem)': {
        borderLeftColor: 'var(--edge)',
        borderLeftStyle: 'solid',
        borderLeftWidth: 1,
      },
    },
    grow: { flexGrow: 1 },
    aiVerdict: {
      background: 'var(--panel)',
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      color: 'var(--dim)',
      fontSize: '0.9rem',
      lineHeight: 1.5,
      padding: '0.9rem 1.1rem',
    },
    code: {
      color: 'var(--dim)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.77rem',
      lineHeight: 1.85,
      margin: 0,
      padding: '1rem 1.1rem',
      whiteSpace: 'pre-wrap',
    },
    cKw: { color: 'var(--purple)' },
    cFn: { color: 'var(--sky)' },
    cStr: { color: 'var(--green)' },
    cBind: { color: 'var(--accent)' },
    cDim: { color: 'var(--faint)' },
    mono: { color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
    bad: { color: 'var(--red)', fontWeight: 600 },
    good: { color: 'var(--green)', fontWeight: 600 },
    rhead: {
      color: 'var(--dim)',
      display: 'flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.72rem',
      justifyContent: 'space-between',
      letterSpacing: '0.03em',
      marginBottom: '0.5rem',
      textTransform: 'uppercase',
    },
    instGrid: {
      alignItems: 'center',
      display: 'grid',
      gap: '3rem',
      gridTemplateColumns: '1fr 1.05fr',
      '@media (max-width: 60rem)': { gap: '2rem', gridTemplateColumns: '1fr' },
    },
    bars: { display: 'flex', flexDirection: 'column', gap: '1.15rem' },
    barNote: {
      color: 'var(--faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      letterSpacing: '0.02em',
      marginTop: '0.4rem',
    },
    track: {
      background: 'var(--panel)',
      borderRadius: 9999,
      height: '0.5rem',
      overflow: 'hidden',
      position: 'relative',
    },
    seg: { bottom: 0, position: 'absolute', top: 0 },
    sIdle: { background: 'var(--faint)' },
    sHatch: {
      background:
        'repeating-linear-gradient(135deg, color-mix(in srgb, var(--amber) 55%, var(--panel)) 0 6px, color-mix(in srgb, var(--amber) 20%, var(--panel)) 6px 12px)',
    },
    sLive: { background: 'color-mix(in srgb, var(--accent) 35%, var(--panel))' },
    sKovo: { background: 'linear-gradient(90deg, var(--accent), var(--accent-soft))' },
    spa1: { left: 0, width: '16%' },
    spa2: { left: '16%', width: '56%' },
    spa3: { left: '72%', width: '28%' },
    ssr1: { left: 0, width: '10%' },
    ssr2: { left: '10%', width: '40%' },
    ssr3: { left: '50%', width: '50%' },
    kovo1: { left: 0, width: '6%' },
    kovo2: { left: '6%', width: '94%' },
    warn: { color: 'var(--amber)' },
    statRow: { display: 'flex', flexWrap: 'wrap', gap: '2.4rem', margin: '2.4rem 0 0' },
    statNum: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: '1.7rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    statLabel: {
      color: 'var(--dim)',
      fontSize: '0.84rem',
      lineHeight: 1.4,
      marginTop: '0.2rem',
      maxWidth: '15rem',
    },

    credLink: {
      borderBottomColor: 'var(--accent)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      color: 'var(--ink)',
      fontWeight: 500,
      textDecoration: 'none',
    },
    faq: {
      borderTopColor: 'var(--edge)',
      borderTopStyle: 'solid',
      borderTopWidth: 1,
      margin: '2.4rem 0 0',
      maxWidth: '54rem',
    },
    faqItem: {
      borderBottomColor: 'var(--edge)',
      borderBottomStyle: 'solid',
      borderBottomWidth: 1,
      '[open] [data-q-plus]': { display: 'none' },
      '[open] [data-q-minus]': { display: 'inline' },
    },
    faqQ: {
      alignItems: 'center',
      color: 'var(--ink)',
      cursor: 'pointer',
      display: 'flex',
      fontFamily: 'var(--font-display)',
      fontSize: '1.15rem',
      fontWeight: 600,
      gap: '1rem',
      justifyContent: 'space-between',
      listStyle: 'none',
      padding: '1.05rem 0',
    },
    faqMark: { color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '1.1rem' },
    qMinus: { display: 'none' },
    faqA: {
      color: 'var(--dim)',
      fontSize: '0.98rem',
      lineHeight: 1.62,
      margin: '0 0 1.2rem',
      maxWidth: '52rem',
    },
    starCta: {
      alignItems: 'center',
      background: 'var(--card)',
      borderColor: 'var(--edge)',
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1.4rem',
      justifyContent: 'space-between',
      margin: '2.8rem 0 0',
      padding: '1.8rem 2rem',
    },
    starCtaH: {
      color: 'var(--ink)',
      fontFamily: 'var(--font-display)',
      fontSize: '1.5rem',
      fontWeight: 600,
      letterSpacing: '-0.015em',
      margin: 0,
    },
    starCtaSub: {
      color: 'var(--dim)',
      fontSize: '0.95rem',
      lineHeight: 1.5,
      margin: '0.4rem 0 0',
      maxWidth: '34rem',
    },
    starBtn: {
      alignItems: 'center',
      background: 'var(--ink)',
      color: 'var(--bg)',
      display: 'inline-flex',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      gap: '0.5rem',
      letterSpacing: '0.07em',
      padding: '0.85rem 1.3rem',
      textDecoration: 'none',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    },
    ghMark: { height: 15, width: 15 },
  },
  { namespace: 'site-page', source: 'site/src/components/landing.tsx' },
);

function InstantLoad(): string {
  return (
    <section style={pageStyles.section}>
      <div style={pageStyles.instGrid}>
        <div>
          <p style={pageStyles.eyebrow}>Instant load</p>
          <h2 style={pageStyles.title}>Interactive at first paint. No uncanny valley.</h2>
          <p style={pageStyles.lead}>
            No hydration means no window where the page looks ready but ignores your clicks. The
            JavaScript you do use loads on first interaction, not on load. Turn JavaScript off and
            every page still renders, every form still posts.
          </p>
          <div style={pageStyles.statRow}>
            <div>
              <div style={pageStyles.statNum}>0&nbsp;ms</div>
              <p style={pageStyles.statLabel}>Time-to-interactive equals first paint.</p>
            </div>
            <div>
              <div style={pageStyles.statNum}>JS&nbsp;off</div>
              <p style={pageStyles.statLabel}>Every page renders, every form posts.</p>
            </div>
          </div>
        </div>
        <div style={pageStyles.bars}>
          <div>
            <p style={pageStyles.rhead}>
              <span>Typical SPA</span>
              <span style={pageStyles.bad}>3.2s</span>
            </p>
            <div style={pageStyles.track}>
              <span style={[pageStyles.seg, pageStyles.sIdle, pageStyles.spa1]}></span>
              <span style={[pageStyles.seg, pageStyles.sHatch, pageStyles.spa2]}></span>
              <span style={[pageStyles.seg, pageStyles.sLive, pageStyles.spa3]}></span>
            </div>
            <p style={pageStyles.barNote}>
              <span style={pageStyles.warn}>&#9888; looks ready, ignores clicks until 3.2s</span>
            </p>
          </div>
          <div>
            <p style={pageStyles.rhead}>
              <span>SSR + hydration</span>
              <span style={pageStyles.bad}>1.6s</span>
            </p>
            <div style={pageStyles.track}>
              <span style={[pageStyles.seg, pageStyles.sIdle, pageStyles.ssr1]}></span>
              <span style={[pageStyles.seg, pageStyles.sHatch, pageStyles.ssr2]}></span>
              <span style={[pageStyles.seg, pageStyles.sLive, pageStyles.ssr3]}></span>
            </div>
            <p style={pageStyles.barNote}>
              <span style={pageStyles.warn}>&#9888; frozen until the bundle hydrates</span>
            </p>
          </div>
          <div>
            <p style={pageStyles.rhead}>
              <span>Kovo</span>
              <span style={pageStyles.good}>first paint</span>
            </p>
            <div style={pageStyles.track}>
              <span style={[pageStyles.seg, pageStyles.sIdle, pageStyles.kovo1]}></span>
              <span style={[pageStyles.seg, pageStyles.sKovo, pageStyles.kovo2]}></span>
            </div>
            <p style={pageStyles.barNote}>
              <span style={pageStyles.good}>
                &#10003; every click works at 0ms, handlers load on demand
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq({ q, children }: { q: string; children: unknown }): string {
  return (
    <details style={pageStyles.faqItem}>
      <summary style={pageStyles.faqQ}>
        {q}
        <span style={pageStyles.faqMark}>
          <span data-q-plus>+</span>
          <span data-q-minus style={pageStyles.qMinus}>
            &#8722;
          </span>
        </span>
      </summary>
      <p style={pageStyles.faqA}>{children}</p>
    </details>
  );
}

function Credibility(): string {
  return (
    <section style={pageStyles.section}>
      <p style={pageStyles.eyebrow}>Who builds this</p>
      <h2 style={pageStyles.title}>Made by people who build AI tools for a living.</h2>
      <p style={pageStyles.lead}>
        Kovo comes from the team behind{' '}
        <a style={pageStyles.credLink} href="https://github.com/dyad-sh/dyad" rel="external">
          Dyad
        </a>
        , the open-source, local AI app builder with 20k+ stars on GitHub. We built Kovo because we
        wanted a target our own agents could generate and verify without guessing.
      </p>

      <div style={pageStyles.faq}>
        <Faq q="Why yet another web framework?">
          Because the stale-UI bug class and the hydration gap are still unsolved at the framework
          level. Kovo turns &ldquo;this view drifted out of sync&rdquo; into a compile error and
          makes first paint interactive. If your stack already proves those two things, you do not
          need Kovo.
        </Faq>
        <Faq q="Can AI agents actually write Kovo code?">
          That is the whole design goal. Generated apps fail{' '}
          <span style={pageStyles.mono}>tsc</span> when wiring is wrong, and{' '}
          <span style={pageStyles.mono}>kovo check</span> returns the exact line, the reason, and
          candidate fixes. The agent loops on edit, check, fixed -- not edit, deploy, bug report.
          Skills, an MCP server, and LLM-readable docs ship with it.
        </Faq>
        <Faq q="Do I have to throw away React?">
          You keep the model you know: composable components, props, TypeScript. You give up the
          client router, hydration, and the runtime store. Kovo compiles your components to real
          HTML and wires interactivity on demand.
        </Faq>
        <Faq q="Is it production-ready?">
          Not yet. Kovo is pre-v1 and under active implementation; nothing is published to npm. The
          spec, the conformance suite, and this site are open -- follow along and kick the tires.
        </Faq>
      </div>

      <div style={pageStyles.starCta}>
        <div>
          <p style={pageStyles.starCtaH}>If this resonates, star it.</p>
          <p style={pageStyles.starCtaSub}>
            Stars tell us the problem is worth solving and help other builders find Kovo early.
          </p>
        </div>
        <a style={pageStyles.starBtn} href="https://github.com/kovojs/kovo" rel="external">
          <svg viewBox="0 0 16 16" style={pageStyles.ghMark} fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Star kovojs/kovo
        </a>
      </div>
    </section>
  );
}
