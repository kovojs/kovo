/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Library icon (Lucide). https://lucide.dev/icons/library */
export function Library(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m16 6 4 14"></path>
      <path d="M12 6v14"></path>
      <path d="M8 8v12"></path>
      <path d="M4 4v16"></path>
    </svg>
  );
}
