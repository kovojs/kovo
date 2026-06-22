/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Tree icon (Lucide). https://lucide.dev/icons/list-tree */
export function ListTree(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 5h13"></path>
      <path d="M13 12h8"></path>
      <path d="M13 19h8"></path>
      <path d="M3 10a2 2 0 0 0 2 2h3"></path>
      <path d="M3 5v12a2 2 0 0 0 2 2h3"></path>
    </svg>
  );
}
