// SPEC §4.5 layouts as first-class route chrome (plans/bugs-and-testing.md C8d;
// testing-audit §5.6): the real layout() primitive attached via route({ layout }),
// with a nested parent, composes chrome around the page in the right order. (The
// existing layout-function-composition fixture only exercises a plain wrapper fn.)
import { createApp, layout, route, type LayoutRenderSlots } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const ShellLayout = layout({
  render: (_queries: unknown, _state: unknown, { children }: LayoutRenderSlots<unknown>) =>
    `<div data-layout="shell"><header>Shell chrome</header>${String(children)}</div>`,
});

const SectionLayout = layout({
  parent: ShellLayout,
  render: (_queries: unknown, _state: unknown, { children }: LayoutRenderSlots<unknown>) =>
    `<section data-layout="section"><nav>Section nav</nav>${String(children)}</section>`,
});

const home = route('/', {
  layout: SectionLayout,
  page: () => `<main data-route="page">Page body</main>`,
});

export default defineFixture({
  app: createApp({ routes: [home] }),
});
