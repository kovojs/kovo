/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart Spline icon (Lucide). https://lucide.dev/icons/chart-spline */
export function ChartSpline(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16"></path>
      <path d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7"></path>
    </svg>
  );
}
