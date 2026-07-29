/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Stretch Horizontal icon (Lucide). https://lucide.dev/icons/stretch-horizontal */
export function StretchHorizontal(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="6" x="2" y="4" rx="2"></rect>
      <rect width="20" height="6" x="2" y="14" rx="2"></rect>
    </svg>
  );
}
