/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Minus icon (Lucide). https://lucide.dev/icons/minus */
export function Minus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 12h14"></path>
    </svg>
  );
}
