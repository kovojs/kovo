/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Chevron Right icon (Lucide). https://lucide.dev/icons/circle-chevron-right */
export function CircleChevronRight(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m10 8 4 4-4 4"></path>
    </svg>
  );
}
