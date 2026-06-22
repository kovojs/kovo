/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List End icon (Lucide). https://lucide.dev/icons/list-end */
export function ListEnd(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M16 12H3"></path>
      <path d="M9 19H3"></path>
      <path d="m16 16-3 3 3 3"></path>
      <path d="M21 5v12a2 2 0 0 1-2 2h-6"></path>
    </svg>
  );
}
