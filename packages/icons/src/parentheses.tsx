/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Parentheses icon (Lucide). https://lucide.dev/icons/parentheses */
export function Parentheses(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 21s-4-3-4-9 4-9 4-9"></path>
      <path d="M16 3s4 3 4 9-4 9-4 9"></path>
    </svg>
  );
}
