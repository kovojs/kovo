import type { Metadata } from 'next';
import Link from 'next/link';

import { CartButton, CartProvider } from './components/cart';
import './globals.css';

export const metadata: Metadata = {
  description: 'Kovo benchmark comparison Next.js entrant.',
  title: 'Next.js Supply Benchmark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-US">
      <body>
        <CartProvider>
          <div className="shell">
            <nav className="nav">
              <Link className="brand" href="/">
                Next Supply
              </Link>
              <CartButton />
            </nav>
            {children}
          </div>
        </CartProvider>
      </body>
    </html>
  );
}
