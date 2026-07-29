/** @jsxImportSource @kovojs/server */
import { redirect } from '@kovojs/core';
import * as style from '@kovojs/style';

import { LoginForm, SignOutForm } from './components/auth-forms.js';
import { ContactsRegion } from './components/contacts.js';
import { appSignIn, appSignOut } from './auth.js';
import { app, appStylesheets } from './kovo.js';
import { addContact } from './mutations.js';
import { contactsQuery } from './queries.js';

// The whole app in one file: a contact book over a real Drizzle database, gated
// by real Better Auth. `kovo({ app: '/src/app.tsx' })` (vite.config.ts) and `kovo
// build ./src/app.tsx` both load this default export (SPEC.md §9.5).

const styles = style.create({
  shell: {
    backgroundColor: style.tokens.sys.color.surface,
    color: style.tokens.sys.color.onSurface,
    marginInline: 'auto',
    maxWidth: 1040,
    minHeight: '100dvh',
    paddingBlock: 32,
    paddingInline: 28,
    '@media (max-width: 640px)': {
      paddingBlock: 20,
      paddingInline: 16,
    },
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: 16,
    justifyContent: 'space-between',
    marginBlockEnd: 32,
    '@media (max-width: 640px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
      gap: 14,
      marginBlockEnd: 28,
    },
  },
  brandGroup: { alignItems: 'center', display: 'flex', gap: 12 },
  mark: {
    alignItems: 'center',
    backgroundColor: style.tokens.sys.color.primary,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    color: style.tokens.sys.color.onPrimary,
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 700,
    height: 34,
    justifyContent: 'center',
    letterSpacing: 0,
    width: 34,
  },
  brandCopy: { display: 'grid', gap: 2 },
  brand: { fontSize: 17, fontWeight: 700, letterSpacing: 0, lineHeight: 1.25 },
  tagline: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
  },
  who: {
    alignItems: 'center',
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'flex',
    fontSize: 14,
    gap: 10,
    justifyContent: 'space-between',
    maxWidth: '100%',
    minWidth: 0,
    '@media (max-width: 640px)': {
      width: '100%',
    },
  },
  userName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  loginMain: {
    alignItems: 'center',
    display: 'grid',
    marginInline: 'auto',
    maxWidth: 440,
    minHeight: 'calc(100dvh - 80px)',
  },
});

const AppLayout = app.layout({
  render: (_queries, _state, { children }) => <div style={styles.shell}>{children}</div>,
});

const healthEndpoint = app.endpoint('/api/health', {
  access: app.publicAccess('public uptime probe'),
  auth: { justification: 'public uptime probe', kind: 'none' },
  csrf: false,
  csrfJustification: 'read-only machine health probe',
  handler: () =>
    Response.json(
      { ok: true },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    ),
  method: 'GET',
  reason: 'read-only machine health probe',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

function HomePage({ userName }: { userName: string }): string {
  return (
    <div>
      <header style={styles.header}>
        <div style={styles.brandGroup}>
          <span aria-hidden="true" style={styles.mark}>
            K
          </span>
          <div style={styles.brandCopy}>
            <span style={styles.brand}>Kovo Starter</span>
            <p style={styles.tagline}>A clean starting point for your next Kovo app.</p>
          </div>
        </div>
        <div style={styles.who}>
          <span style={styles.userName}>{userName}</span>
          <SignOutForm />
        </div>
      </header>
      <main>
        <ContactsRegion />
      </main>
    </div>
  );
}

const homeRoute = app.route('/', {
  // The contact book is the signed-in user's data, so this route's KV436 access
  // decision is the session-presence guard (SPEC §10.2). The redirect below is
  // the no-JS UX for an unauthenticated visitor.
  access: [app.authenticated],
  meta: {
    description: 'A Kovo starter: a contact book over a real database, gated by real auth.',
    title: 'Kovo Starter',
  },
  layout: AppLayout,
  stylesheets: appStylesheets,
  page(_context, request) {
    // The read is public-shaped, but the page requires a session so the guarded
    // add-contact form always has one (SPEC.md §9.5 redirect outcome).
    if (!request.session) return redirect('/login', {});
    return <HomePage userName={request.session.user.name} />;
  },
});

const loginRoute = app.route('/login', {
  // Sign-in page reachable before authentication — public by design (KV436, §10.2).
  access: app.publicAccess('sign-in page reachable before authentication'),
  meta: { description: 'Sign in to the Kovo starter.', title: 'Sign in · Kovo Starter' },
  layout: AppLayout,
  stylesheets: appStylesheets,
  page(_context, request) {
    // A session transition deliberately performs a full document reload (SPEC §9.3).
    // Complete sign-in by moving an already-authenticated reload to the guarded home route.
    if (request.session) return redirect('/', {});
    return (
      <main style={styles.loginMain}>
        <LoginForm />
      </main>
    );
  },
});

// Better Auth credential mutations retain their package-owned fixed identity and private
// capability; the app contract accepts only their opaque adapter witness.
const signInMutation = app.integrateMutation(appSignIn);
const signOutMutation = app.integrateMutation(appSignOut);

const assembledApp = app.assemble({
  endpoints: [healthEndpoint],
  layouts: [AppLayout],
  mutations: [addContact, signInMutation, signOutMutation],
  queries: [contactsQuery],
  routes: [homeRoute, loginRoute],
});

export default assembledApp;
