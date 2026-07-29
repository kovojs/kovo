/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Chevron Up icon (Lucide). https://lucide.dev/icons/circle-chevron-up */
export function CircleChevronUp(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m8 14 4-4 4 4"></path>
    </svg>
  );
}
