/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Gauge icon (Lucide). https://lucide.dev/icons/circle-gauge */
export function CircleGauge(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15.6 2.7a10 10 0 1 0 5.7 5.7"></path>
      <circle cx="12" cy="12" r="2"></circle>
      <path d="M13.4 10.6 19 5"></path>
    </svg>
  );
}
