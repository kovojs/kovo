import type { Metadata } from 'next';

import '../globals.css';

export const metadata: Metadata = {
  description: 'Capability-matched L1 benchmark entrant.',
  title: 'Matched L1 Supply Benchmark',
};

export default function MatchedL1Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-US">
      <body>{children}</body>
    </html>
  );
}
