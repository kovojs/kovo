/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down Narrow Wide icon (Lucide). https://lucide.dev/icons/arrow-down-narrow-wide */
export function ArrowDownNarrowWide(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 16 4 4 4-4"></path>
      <path d="M7 20V4"></path>
      <path d="M11 4h4"></path>
      <path d="M11 8h7"></path>
      <path d="M11 12h10"></path>
    </svg>
  );
}
