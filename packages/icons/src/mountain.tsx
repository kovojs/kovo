/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mountain icon (Lucide). https://lucide.dev/icons/mountain */
export function Mountain(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m8 3 4 8 5-5 5 15H2L8 3z"></path>
    </svg>
  );
}
