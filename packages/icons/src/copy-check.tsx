/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Copy Check icon (Lucide). https://lucide.dev/icons/copy-check */
export function CopyCheck(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m12 15 2 2 4-4"></path>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    </svg>
  );
}
