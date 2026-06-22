/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Laugh icon (Lucide). https://lucide.dev/icons/laugh */
export function Laugh(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z"></path>
      <line x1="9" x2="9.01" y1="9" y2="9"></line>
      <line x1="15" x2="15.01" y1="9" y2="9"></line>
    </svg>
  );
}
