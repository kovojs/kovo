/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Alarm Clock Off icon (Lucide). https://lucide.dev/icons/alarm-clock-off */
export function AlarmClockOff(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6.87 6.87a8 8 0 1 0 11.26 11.26"></path>
      <path d="M19.9 14.25a8 8 0 0 0-9.15-9.15"></path>
      <path d="m22 6-3-3"></path>
      <path d="M6.26 18.67 4 21"></path>
      <path d="m2 2 20 20"></path>
      <path d="M4 4 2 6"></path>
    </svg>
  );
}
