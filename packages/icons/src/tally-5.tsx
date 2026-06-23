/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Tally 5 icon (Lucide). https://lucide.dev/icons/tally-5 */
export function Tally5(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 4v16"></path>
      <path d="M9 4v16"></path>
      <path d="M14 4v16"></path>
      <path d="M19 4v16"></path>
      <path d="M22 6 2 18"></path>
    </svg>
  );
}
