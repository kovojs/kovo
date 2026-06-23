/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Equal icon (Lucide). https://lucide.dev/icons/equal */
export function Equal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="5" x2="19" y1="9" y2="9"></line>
      <line x1="5" x2="19" y1="15" y2="15"></line>
    </svg>
  );
}
