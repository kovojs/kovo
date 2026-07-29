/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Up icon (Lucide). https://lucide.dev/icons/chevrons-up */
export function ChevronsUp(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 11-5-5-5 5"></path>
      <path d="m17 18-5-5-5 5"></path>
    </svg>
  );
}
