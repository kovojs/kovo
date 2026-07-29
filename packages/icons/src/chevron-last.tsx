/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevron Last icon (Lucide). https://lucide.dev/icons/chevron-last */
export function ChevronLast(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 18 6-6-6-6"></path>
      <path d="M17 6v12"></path>
    </svg>
  );
}
