// Generated from packages/ui/scripts/primitive-component-manifest.mjs. Run `node packages/ui/scripts/build-registry.mjs --write`.

import { galleryComponentEntries, type GalleryComponent } from './gallery-component-manifest.js';

export interface GalleryComponentEntry {
  component: GalleryComponent;
  summary: string;
  title: string;
}

export const galleryComponentCatalog: readonly GalleryComponentEntry[] = Object.freeze(
  galleryComponentEntries.map(({ component, summary, title }) => ({ component, summary, title })),
);
