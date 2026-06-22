/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Iteration Cw icon (Lucide). https://lucide.dev/icons/iteration-cw */
export function IterationCw(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 10a8 8 0 1 1 8 8H4"></path>
      <path d="m8 22-4-4 4-4"></path>
    </svg>
  );
}
