/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Filter Plus icon (Lucide). https://lucide.dev/icons/list-filter-plus */
export function ListFilterPlus(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 5H2"></path>
      <path d="M6 12h12"></path>
      <path d="M9 19h6"></path>
      <path d="M16 5h6"></path>
      <path d="M19 8V2"></path>
    </svg>
  );
}
