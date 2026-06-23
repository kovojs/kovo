/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Circle Divide icon (Lucide). https://lucide.dev/icons/circle-divide */
export function CircleDivide(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="8" x2="16" y1="12" y2="12"></line>
      <line x1="12" x2="12" y1="16" y2="16"></line>
      <line x1="12" x2="12" y1="8" y2="8"></line>
    </svg>
  );
}
