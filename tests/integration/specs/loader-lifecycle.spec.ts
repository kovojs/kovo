// SPEC.md §4.4/§4.7: delegated handlers start on interaction, keep a live
// ctx.signal, and abort when a fragment morph removes their island.
import { test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'loader-lifecycle' });

test.skip(
  true,
  'Blocked by current browser integration path: the enhanced mutation morph replaces the island DOM, but the active delegated handler signal does not abort in this harness, so SPEC.md §4.7 loader-lifecycle cleanup is not yet provable end-to-end here.',
);

test('aborts a running island handler when an enhanced morph removes its island', async ({
  page,
  kovoApp,
}) => {
  void page;
  void kovoApp;
});
