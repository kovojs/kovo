/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Move Diagonal icon (Lucide). https://lucide.dev/icons/move-diagonal */
export function MoveDiagonal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 19H5v-6"></path>
      <path d="M13 5h6v6"></path>
      <path d="M19 5 5 19"></path>
    </svg>
  );
}
