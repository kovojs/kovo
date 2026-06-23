/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Ungroup icon (Lucide). https://lucide.dev/icons/ungroup */
export function Ungroup(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="8" height="6" x="5" y="4" rx="1"></rect>
      <rect width="8" height="6" x="11" y="14" rx="1"></rect>
    </svg>
  );
}
