import type { Metadata } from 'next';

import '../globals.css';

export const metadata: Metadata = {
  description: 'Capability-matched L0 benchmark entrant.',
  title: 'Matched L0 Supply Benchmark',
};

export default function MatchedL0Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-US">
      <body>{children}</body>
    </html>
  );
}
