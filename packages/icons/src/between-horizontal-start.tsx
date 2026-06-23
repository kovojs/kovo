/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Between Horizontal Start icon (Lucide). https://lucide.dev/icons/between-horizontal-start */
export function BetweenHorizontalStart(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="13" height="7" x="8" y="3" rx="1"></rect>
      <path d="m2 9 3 3-3 3"></path>
      <rect width="13" height="7" x="8" y="14" rx="1"></rect>
    </svg>
  );
}
