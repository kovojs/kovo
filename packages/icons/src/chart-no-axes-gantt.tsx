/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chart No Axes Gantt icon (Lucide). https://lucide.dev/icons/chart-no-axes-gantt */
export function ChartNoAxesGantt(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 5h12"></path>
      <path d="M4 12h10"></path>
      <path d="M12 19h8"></path>
    </svg>
  );
}
