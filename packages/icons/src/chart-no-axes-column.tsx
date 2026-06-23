/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chart No Axes Column icon (Lucide). https://lucide.dev/icons/chart-no-axes-column */
export function ChartNoAxesColumn(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 21v-6"></path>
      <path d="M12 21V3"></path>
      <path d="M19 21V9"></path>
    </svg>
  );
}
