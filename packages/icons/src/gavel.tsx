/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Gavel icon (Lucide). https://lucide.dev/icons/gavel */
export function Gavel(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"></path>
      <path d="m16 16 6-6"></path>
      <path d="m21.5 10.5-8-8"></path>
      <path d="m8 8 6-6"></path>
      <path d="m8.5 7.5 8 8"></path>
    </svg>
  );
}
