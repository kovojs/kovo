import { MatchedListing } from '../../../_matched/content';
import { MatchedL1Shell } from '../../../_matched/l1-shell';

const basePath = '/matched/l1';

export default function MatchedL1Page() {
  return (
    <MatchedL1Shell basePath={basePath}>
      <MatchedListing basePath={basePath} />
    </MatchedL1Shell>
  );
}
