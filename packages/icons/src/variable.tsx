/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Variable icon (Lucide). https://lucide.dev/icons/variable */
export function Variable(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 21s-4-3-4-9 4-9 4-9"></path>
      <path d="M16 3s4 3 4 9-4 9-4 9"></path>
      <line x1="15" x2="9" y1="9" y2="15"></line>
      <line x1="9" x2="15" y1="9" y2="15"></line>
    </svg>
  );
}
