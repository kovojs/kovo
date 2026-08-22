import { MatchedListing } from '../../../../_matched/content';
import { MatchedL0Shell } from '../../../../_matched/l0-shell';

// Match Kovo's SPEC §9.4 shared-cache-closed fixture without making the visible representation
// unstable. The server benchmark proves the no-store posture on every response.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const contentBasePath = '/matched/l0';

export default function MatchedDynamicPage() {
  return (
    <MatchedL0Shell basePath={contentBasePath}>
      <MatchedListing basePath={contentBasePath} />
    </MatchedL0Shell>
  );
}
