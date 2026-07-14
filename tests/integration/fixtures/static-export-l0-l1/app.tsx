import { defineFixture } from '@kovojs/test/internal/integration/define';

import { createStaticExportL0L1App } from './app-definition';

export { createStaticExportL0L1App } from './app-definition';
export type { StaticExportRenderCounter } from './app-definition';

export default defineFixture({ app: createStaticExportL0L1App() });
