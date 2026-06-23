/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Squares Subtract icon (Lucide). https://lucide.dev/icons/squares-subtract */
export function SquaresSubtract(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 22a2 2 0 0 1-2-2"></path>
      <path d="M16 22h-2"></path>
      <path d="M16 4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-5a2 2 0 0 1 2-2h5a1 1 0 0 0 1-1z"></path>
      <path d="M20 8a2 2 0 0 1 2 2"></path>
      <path d="M22 14v2"></path>
      <path d="M22 20a2 2 0 0 1-2 2"></path>
    </svg>
  );
}
