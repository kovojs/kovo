/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Lock Keyhole Open icon (Lucide). https://lucide.dev/icons/lock-keyhole-open */
export function LockKeyholeOpen(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="16" r="1"></circle>
      <rect width="18" height="12" x="3" y="10" rx="2"></rect>
      <path d="M7 10V7a5 5 0 0 1 9.33-2.5"></path>
    </svg>
  );
}
