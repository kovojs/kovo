/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart No Axes Gantt icon (Lucide). https://lucide.dev/icons/chart-no-axes-gantt */
export function ChartNoAxesGantt(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 5h12"></path>
      <path d="M4 12h10"></path>
      <path d="M12 19h8"></path>
    </svg>
  );
}
