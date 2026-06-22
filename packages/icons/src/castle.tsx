/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Castle icon (Lucide). https://lucide.dev/icons/castle */
export function Castle(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 5V3"></path>
      <path d="M14 5V3"></path>
      <path d="M15 21v-3a3 3 0 0 0-6 0v3"></path>
      <path d="M18 3v8"></path>
      <path d="M18 5H6"></path>
      <path d="M22 11H2"></path>
      <path d="M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"></path>
      <path d="M6 3v8"></path>
    </svg>
  );
}
