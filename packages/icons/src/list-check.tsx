/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** List Check icon (Lucide). https://lucide.dev/icons/list-check */
export function ListCheck(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M16 12H3"></path>
      <path d="M11 19H3"></path>
      <path d="m15 18 2 2 4-4"></path>
    </svg>
  );
}
