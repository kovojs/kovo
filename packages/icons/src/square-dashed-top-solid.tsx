/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Dashed Top Solid icon (Lucide). https://lucide.dev/icons/square-dashed-top-solid */
export function SquareDashedTopSolid(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 21h1"></path>
      <path d="M21 14v1"></path>
      <path d="M21 19a2 2 0 0 1-2 2"></path>
      <path d="M21 9v1"></path>
      <path d="M3 14v1"></path>
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2"></path>
      <path d="M3 9v1"></path>
      <path d="M5 21a2 2 0 0 1-2-2"></path>
      <path d="M9 21h1"></path>
    </svg>
  );
}
