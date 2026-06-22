/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Sigma icon (Lucide). https://lucide.dev/icons/square-sigma */
export function SquareSigma(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M16 8.9V7H8l4 5-4 5h8v-1.9"></path>
    </svg>
  );
}
