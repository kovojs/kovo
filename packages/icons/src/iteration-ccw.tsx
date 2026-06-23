/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Iteration Ccw icon (Lucide). https://lucide.dev/icons/iteration-ccw */
export function IterationCcw(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m16 14 4 4-4 4"></path>
      <path d="M20 10a8 8 0 1 0-8 8h8"></path>
    </svg>
  );
}
