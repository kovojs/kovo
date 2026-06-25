/** @jsxImportSource @kovojs/server */
import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  layout,
  publicAccess,
  redirect,
  route,
  stylesheet,
  type RequestHandler,
} from '@kovojs/server';
import * as style from '@kovojs/style';

import { LoginForm, SignOutForm } from './components/auth-forms.js';
import { ContactsRegion } from './components/contacts.js';
import {
  appAuthed,
  appSessionProvider,
  appSignIn,
  appSignOut,
  seedDemoUser,
  type AppRequest,
} from './auth.js';
import { appDb } from './db.js';
import { addContact } from './mutations.js';
import { contactsQuery } from './queries.js';
import { appTheme } from './theme.js';

// The whole app in one file: a contact book over a real Drizzle database, gated
// by real Better Auth. `kovo({ app: '/src/app.tsx' })` (vite.config.ts) and `kovo
// build ./src/app.tsx` both load this default export (SPEC.md §9.5).

// Seed the local demo account when the generated .env contains KOVO_DEMO_PASSWORD.
await seedDemoUser();

const stylesheets = [stylesheet('./styles.css', { theme: appTheme })] as const;

const styles = style.create({
  shell: {
    color: style.tokens.sys.color.onSurface,
    marginInline: 'auto',
    maxWidth: 768,
    minHeight: '100dvh',
    paddingBlock: 32,
    paddingInline: 24,
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: 16,
    justifyContent: 'space-between',
    marginBlockEnd: 24,
  },
  brand: { fontSize: 18, fontWeight: 700 },
  who: {
    alignItems: 'center',
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'flex',
    fontSize: 14,
    gap: 12,
  },
  loginMain: { marginInline: 'auto', maxWidth: 384, paddingBlock: 48 },
});

const AppLayout = layout({
  render: (_queries, _state, { children }) => <div style={styles.shell}>{children}</div>,
});

function HomePage({ request }: { request: AppRequest }): string {
  return (
    <div>
      <header style={styles.header}>
        <span style={styles.brand}>Kovo Starter</span>
        <span style={styles.who}>
          {request.session?.user.name ?? 'Guest'}
          <SignOutForm />
        </span>
      </header>
      <ContactsRegion />
    </div>
  );
}

const app = createApp({
  clientModules: createMemoryVersionedClientModuleRegistry(),
  db: () => appDb,
  document: { lang: 'en' },
  mutations: [addContact, appSignIn, appSignOut],
  queries: [contactsQuery],
  sessionProvider: appSessionProvider,
  routes: [
    route('/', {
      // The contact book is the signed-in user's data, so this route's KV436 access
      // decision is the session-presence guard (SPEC §10.2). The redirect below is
      // the no-JS UX for an unauthenticated visitor.
      guard: appAuthed,
      meta: {
        description: 'A Kovo starter: a contact book over a real database, gated by real auth.',
        title: 'Kovo Starter',
      },
      layout: AppLayout,
      stylesheets,
      page(_context, request: AppRequest) {
        // The read is public-shaped, but the page requires a session so the guarded
        // add-contact form always has one (SPEC.md §9.5 redirect outcome).
        if (!request.session) return redirect('/login', {});
        return <HomePage request={request} />;
      },
    }),
    route('/login', {
      // Sign-in page reachable before authentication — public by design (KV436, §10.2).
      access: publicAccess('sign-in page reachable before authentication'),
      meta: { description: 'Sign in to the Kovo starter.', title: 'Sign in · Kovo Starter' },
      layout: AppLayout,
      stylesheets,
      page() {
        return (
          <main style={styles.loginMain}>
            <LoginForm />
          </main>
        );
      },
    }),
  ],
});

export const requestHandler: RequestHandler = createRequestHandler(app);
export default app;
