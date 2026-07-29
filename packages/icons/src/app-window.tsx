/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** App Window icon (Lucide). https://lucide.dev/icons/app-window */
export function AppWindow(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="2" y="4" width="20" height="16" rx="2"></rect>
      <path d="M10 4v4"></path>
      <path d="M2 8h20"></path>
      <path d="M6 4v4"></path>
    </svg>
  );
}
