/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Right Open icon (Lucide). https://lucide.dev/icons/panel-right-open */
export function PanelRightOpen(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M15 3v18"></path>
      <path d="m10 15-3-3 3-3"></path>
    </svg>
  );
}
