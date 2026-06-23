/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** List Plus icon (Lucide). https://lucide.dev/icons/list-plus */
export function ListPlus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M11 12H3"></path>
      <path d="M16 19H3"></path>
      <path d="M18 9v6"></path>
      <path d="M21 12h-6"></path>
    </svg>
  );
}
