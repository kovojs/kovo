/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart No Axes Column Decreasing icon (Lucide). https://lucide.dev/icons/chart-no-axes-column-decreasing */
export function ChartNoAxesColumnDecreasing(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 21V3"></path>
      <path d="M12 21V9"></path>
      <path d="M19 21v-6"></path>
    </svg>
  );
}
