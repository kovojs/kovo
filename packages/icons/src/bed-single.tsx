/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bed Single icon (Lucide). https://lucide.dev/icons/bed-single */
export function BedSingle(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 20v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"></path>
      <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"></path>
      <path d="M3 18h18"></path>
    </svg>
  );
}
