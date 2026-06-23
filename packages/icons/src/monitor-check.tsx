/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Monitor Check icon (Lucide). https://lucide.dev/icons/monitor-check */
export function MonitorCheck(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m9 10 2 2 4-4"></path>
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <path d="M12 17v4"></path>
      <path d="M8 21h8"></path>
    </svg>
  );
}
