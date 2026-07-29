/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Layout Template icon (Lucide). https://lucide.dev/icons/layout-template */
export function LayoutTemplate(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="7" x="3" y="3" rx="1"></rect>
      <rect width="9" height="7" x="3" y="14" rx="1"></rect>
      <rect width="5" height="7" x="16" y="14" rx="1"></rect>
    </svg>
  );
}
