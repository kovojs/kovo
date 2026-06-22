/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Case Lower icon (Lucide). https://lucide.dev/icons/case-lower */
export function CaseLower(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 9v7"></path>
      <path d="M14 6v10"></path>
      <circle cx="17.5" cy="12.5" r="3.5"></circle>
      <circle cx="6.5" cy="12.5" r="3.5"></circle>
    </svg>
  );
}
