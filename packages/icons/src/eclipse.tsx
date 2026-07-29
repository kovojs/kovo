/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Eclipse icon (Lucide). https://lucide.dev/icons/eclipse */
export function Eclipse(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 2a7 7 0 1 0 10 10"></path>
    </svg>
  );
}
