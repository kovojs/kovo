// Public root intentionally exposes only the shared icon props type. Every icon
// is its own subpath export (e.g. `@kovojs/icons/arrow-right`) so consumers pull
// in exactly the glyphs they use — no barrel, inherent tree-shaking. Mirrors
// `@kovojs/ui`'s empty root (packages/ui/src/index.tsx).
export type { IconProps, IconRenderResult } from './icon-base.js';
