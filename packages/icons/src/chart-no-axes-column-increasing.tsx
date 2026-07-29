/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart No Axes Column Increasing icon (Lucide). https://lucide.dev/icons/chart-no-axes-column-increasing */
export function ChartNoAxesColumnIncreasing(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 21v-6"></path>
      <path d="M12 21V9"></path>
      <path d="M19 21V3"></path>
    </svg>
  );
}
