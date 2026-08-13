import { MatchedListing } from '../../../_matched/content';
import { MatchedL0Shell } from '../../../_matched/l0-shell';

const basePath = '/matched/l0';

export default function MatchedL0Page() {
  return (
    <MatchedL0Shell basePath={basePath}>
      <MatchedListing basePath={basePath} />
    </MatchedL0Shell>
  );
}
