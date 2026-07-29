/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Rectangle Vertical icon (Lucide). https://lucide.dev/icons/rectangle-vertical */
export function RectangleVertical(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="12" height="20" x="6" y="2" rx="2"></rect>
    </svg>
  );
}
