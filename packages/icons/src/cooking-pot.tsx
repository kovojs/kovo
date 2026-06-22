/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cooking Pot icon (Lucide). https://lucide.dev/icons/cooking-pot */
export function CookingPot(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 12h20"></path>
      <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"></path>
      <path d="m4 8 16-4"></path>
      <path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8"></path>
    </svg>
  );
}
