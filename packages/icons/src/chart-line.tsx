/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chart Line icon (Lucide). https://lucide.dev/icons/chart-line */
export function ChartLine(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16"></path>
      <path d="m19 9-5 5-4-4-3 3"></path>
    </svg>
  );
}
