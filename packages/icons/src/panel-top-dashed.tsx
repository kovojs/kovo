/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Top Dashed icon (Lucide). https://lucide.dev/icons/panel-top-dashed */
export function PanelTopDashed(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M14 9h1"></path>
      <path d="M19 9h2"></path>
      <path d="M3 9h2"></path>
      <path d="M9 9h1"></path>
    </svg>
  );
}
