/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Battery Charging icon (Lucide). https://lucide.dev/icons/battery-charging */
export function BatteryCharging(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m11 7-3 5h4l-3 5"></path>
      <path d="M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935"></path>
      <path d="M22 14v-4"></path>
      <path d="M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936"></path>
    </svg>
  );
}
