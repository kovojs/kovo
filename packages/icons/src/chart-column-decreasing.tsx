/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart Column Decreasing icon (Lucide). https://lucide.dev/icons/chart-column-decreasing */
export function ChartColumnDecreasing(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 17V9"></path>
      <path d="M18 17v-3"></path>
      <path d="M3 3v16a2 2 0 0 0 2 2h16"></path>
      <path d="M8 17V5"></path>
    </svg>
  );
}
