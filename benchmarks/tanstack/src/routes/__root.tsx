import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';

import { CartButton, CartProvider } from '../components/cart';
import '../styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'TanStack Supply Benchmark' },
      {
        name: 'description',
        content: 'Kovo benchmark comparison TanStack Start entrant.',
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <CartProvider>
        <div className="shell">
          <nav className="nav">
            <Link className="brand" to="/">
              TanStack Supply
            </Link>
            <CartButton />
          </nav>
          <Outlet />
        </div>
      </CartProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-US">
      <head>
        <HeadContent />
        <link rel="stylesheet" href="/assets/index.css" />
      </head>
      <body>
        {children}
        <Scripts />
        <script type="module" async src="/assets/index.js" />
      </body>
    </html>
  );
}
