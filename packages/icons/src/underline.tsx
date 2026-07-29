/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Underline icon (Lucide). https://lucide.dev/icons/underline */
export function Underline(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 4v6a6 6 0 0 0 12 0V4"></path>
      <line x1="4" x2="20" y1="20" y2="20"></line>
    </svg>
  );
}
