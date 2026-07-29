/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Person Standing icon (Lucide). https://lucide.dev/icons/person-standing */
export function PersonStanding(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="5" r="1"></circle>
      <path d="m9 20 3-6 3 6"></path>
      <path d="m6 8 6 2 6-2"></path>
      <path d="M12 10v4"></path>
    </svg>
  );
}
