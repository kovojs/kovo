/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle X icon (Lucide). https://lucide.dev/icons/circle-x */
export function CircleX(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m15 9-6 6"></path>
      <path d="m9 9 6 6"></path>
    </svg>
  );
}
