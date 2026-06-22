/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Message Square Lock icon (Lucide). https://lucide.dev/icons/message-square-lock */
export function MessageSquareLock(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 8.5V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16.286a.71.71 0 0 0 1.212.502l2.202-2.202A2 2 0 0 1 6.828 19H10"></path>
      <path d="M20 15v-2a2 2 0 0 0-4 0v2"></path>
      <rect x="14" y="15" width="8" height="5" rx="1"></rect>
    </svg>
  );
}
