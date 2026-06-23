/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chart Bar Increasing icon (Lucide). https://lucide.dev/icons/chart-bar-increasing */
export function ChartBarIncreasing(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16"></path>
      <path d="M7 11h8"></path>
      <path d="M7 16h12"></path>
      <path d="M7 6h3"></path>
    </svg>
  );
}
