/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Gallery Horizontal icon (Lucide). https://lucide.dev/icons/gallery-horizontal */
export function GalleryHorizontal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 3v18"></path>
      <rect width="12" height="18" x="6" y="3" rx="2"></rect>
      <path d="M22 3v18"></path>
    </svg>
  );
}
