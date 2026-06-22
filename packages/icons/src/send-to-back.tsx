/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Send To Back icon (Lucide). https://lucide.dev/icons/send-to-back */
export function SendToBack(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="14" y="14" width="8" height="8" rx="2"></rect>
      <rect x="2" y="2" width="8" height="8" rx="2"></rect>
      <path d="M7 14v1a2 2 0 0 0 2 2h1"></path>
      <path d="M14 7h1a2 2 0 0 1 2 2v1"></path>
    </svg>
  );
}
