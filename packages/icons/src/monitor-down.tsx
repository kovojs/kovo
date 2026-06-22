/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Monitor Down icon (Lucide). https://lucide.dev/icons/monitor-down */
export function MonitorDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 13V7"></path>
      <path d="m15 10-3 3-3-3"></path>
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <path d="M12 17v4"></path>
      <path d="M8 21h8"></path>
    </svg>
  );
}
