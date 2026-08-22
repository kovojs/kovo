import type { Metadata } from 'next';

import '../globals.css';

export const metadata: Metadata = {
  description: 'Capability-matched forced-dynamic benchmark entrant.',
  title: 'Matched Dynamic Supply Benchmark',
};

export default function MatchedRuntimeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-US">
      <body>{children}</body>
    </html>
  );
}
