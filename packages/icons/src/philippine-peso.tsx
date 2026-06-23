/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Philippine Peso icon (Lucide). https://lucide.dev/icons/philippine-peso */
export function PhilippinePeso(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 11H4"></path>
      <path d="M20 7H4"></path>
      <path d="M7 21V4a1 1 0 0 1 1-1h4a1 1 0 0 1 0 12H7"></path>
    </svg>
  );
}
