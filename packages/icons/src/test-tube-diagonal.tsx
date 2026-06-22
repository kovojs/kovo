/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Test Tube Diagonal icon (Lucide). https://lucide.dev/icons/test-tube-diagonal */
export function TestTubeDiagonal(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01a2.83 2.83 0 0 1 0-4L17 3"></path>
      <path d="m16 2 6 6"></path>
      <path d="M12 16H4"></path>
    </svg>
  );
}
