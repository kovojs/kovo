/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Lock Keyhole icon (Lucide). https://lucide.dev/icons/lock-keyhole */
export function LockKeyhole(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="16" r="1"></circle>
      <rect x="3" y="10" width="18" height="12" rx="2"></rect>
      <path d="M7 10V7a5 5 0 0 1 10 0v3"></path>
    </svg>
  );
}
