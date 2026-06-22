/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Binary icon (Lucide). https://lucide.dev/icons/binary */
export function Binary(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="14" y="14" width="4" height="6" rx="2"></rect>
      <rect x="6" y="4" width="4" height="6" rx="2"></rect>
      <path d="M6 20h4"></path>
      <path d="M14 10h4"></path>
      <path d="M6 14h2v6"></path>
      <path d="M14 4h2v6"></path>
    </svg>
  );
}
