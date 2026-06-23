/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Chart Gantt icon (Lucide). https://lucide.dev/icons/square-chart-gantt */
export function SquareChartGantt(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M9 8h7"></path>
      <path d="M8 12h6"></path>
      <path d="M11 16h5"></path>
    </svg>
  );
}
