/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Dollar Sign icon (Lucide). https://lucide.dev/icons/dollar-sign */
export function DollarSign(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="12" x2="12" y1="2" y2="22"></line>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
    </svg>
  );
}
