/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Archive icon (Lucide). https://lucide.dev/icons/archive */
export function Archive(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="5" x="2" y="3" rx="1"></rect>
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path>
      <path d="M10 12h4"></path>
    </svg>
  );
}
