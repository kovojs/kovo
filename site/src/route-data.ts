import type {
  ApiSidebar as ApiSidebarData,
  DocSection,
  Heading,
  NavGroup,
  NavLink,
} from './content.js';
import type { ExampleSplitInput } from './components/example-split.js';
import type { GalleryPageInput } from './components/gallery.js';

export type DocsRouteContent =
  | { html: string; kind: 'html'; prose?: boolean }
  | { html: string; kind: 'spec' }
  | { kind: 'section-index'; section: SectionIndexInput }
  | { example: ExampleSplitInput; kind: 'example' }
  | { gallery: GalleryPageInput; kind: 'gallery' };

export interface DocsRoutePageData {
  activePath: string;
  /** When set (API reference pages), the right rail renders the category-grouped
   * API navigation instead of the flat heading TOC. */
  apiSidebar?: ApiSidebarData | undefined;
  content: DocsRouteContent;
  eyebrow?: string | undefined;
  groups: NavGroup[];
  headings?: Heading[] | undefined;
  next?: NavLink | undefined;
  prev?: NavLink | undefined;
}

export interface SectionIndexInput {
  key: string;
  pages: { description?: string; title: string; url: string }[];
  title: string;
}

/** Convenience: the section-index input for a content DocSection. */
export function sectionIndexInput(section: DocSection): SectionIndexInput {
  return {
    key: section.key,
    pages: section.pages.map((page) => ({
      description: page.description,
      title: page.title,
      url: page.url,
    })),
    title: section.title,
  };
}
