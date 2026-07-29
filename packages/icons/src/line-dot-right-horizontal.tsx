/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Line Dot Right Horizontal icon (Lucide). https://lucide.dev/icons/line-dot-right-horizontal */
export function LineDotRightHorizontal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M 3 12 L 15 12"></path>
      <circle cx="18" cy="12" r="3"></circle>
    </svg>
  );
}
