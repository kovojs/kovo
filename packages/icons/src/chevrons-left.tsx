/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Left icon (Lucide). https://lucide.dev/icons/chevrons-left */
export function ChevronsLeft(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m11 17-5-5 5-5"></path>
      <path d="m18 17-5-5 5-5"></path>
    </svg>
  );
}
