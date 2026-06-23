/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** List Collapse icon (Lucide). https://lucide.dev/icons/list-collapse */
export function ListCollapse(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 5h11"></path>
      <path d="M10 12h11"></path>
      <path d="M10 19h11"></path>
      <path d="m3 10 3-3-3-3"></path>
      <path d="m3 20 3-3-3-3"></path>
    </svg>
  );
}
