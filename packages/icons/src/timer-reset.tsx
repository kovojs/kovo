/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Timer Reset icon (Lucide). https://lucide.dev/icons/timer-reset */
export function TimerReset(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 2h4"></path>
      <path d="M12 14v-4"></path>
      <path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6"></path>
      <path d="M9 17H4v5"></path>
    </svg>
  );
}
