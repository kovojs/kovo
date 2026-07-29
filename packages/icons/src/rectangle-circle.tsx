/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Rectangle Circle icon (Lucide). https://lucide.dev/icons/rectangle-circle */
export function RectangleCircle(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 4v16H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"></path>
      <circle cx="14" cy="12" r="8"></circle>
    </svg>
  );
}
