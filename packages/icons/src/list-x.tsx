/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** List X icon (Lucide). https://lucide.dev/icons/list-x */
export function ListX(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M11 12H3"></path>
      <path d="M16 19H3"></path>
      <path d="m15.5 9.5 5 5"></path>
      <path d="m20.5 9.5-5 5"></path>
    </svg>
  );
}
