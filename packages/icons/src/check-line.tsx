/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Check Line icon (Lucide). https://lucide.dev/icons/check-line */
export function CheckLine(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 4L9 15"></path>
      <path d="M21 19L3 19"></path>
      <path d="M9 15L4 10"></path>
    </svg>
  );
}
