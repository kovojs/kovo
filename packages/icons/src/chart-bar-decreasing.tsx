/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart Bar Decreasing icon (Lucide). https://lucide.dev/icons/chart-bar-decreasing */
export function ChartBarDecreasing(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16"></path>
      <path d="M7 11h8"></path>
      <path d="M7 16h3"></path>
      <path d="M7 6h12"></path>
    </svg>
  );
}
