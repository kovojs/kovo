import { readFileSync } from 'node:fs';

export interface GalleryCompilerProjectFile {
  readonly fileName: string;
  readonly source: string;
}

/** Finite local re-export graph used to prove gallery handler identities under SPEC §5.2. */
export function galleryHandlerCompilerProjectFiles(
  directory = 'src',
): readonly GalleryCompilerProjectFile[] {
  return [
    {
      fileName: `${directory}/primitive-actions.ts`,
      source: readFileSync(new URL('./primitive-actions.ts', import.meta.url), 'utf8'),
    },
    {
      fileName: `${directory}/primitive-actions.generated.ts`,
      source: readFileSync(new URL('./primitive-actions.generated.ts', import.meta.url), 'utf8'),
    },
  ];
}
