/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Timer Off icon (Lucide). https://lucide.dev/icons/timer-off */
export function TimerOff(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 2h4"></path>
      <path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7"></path>
      <path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2"></path>
      <path d="m2 2 20 20"></path>
      <path d="M12 12v-2"></path>
    </svg>
  );
}
