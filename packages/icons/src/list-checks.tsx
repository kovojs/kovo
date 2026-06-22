/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Checks icon (Lucide). https://lucide.dev/icons/list-checks */
export function ListChecks(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 5h8"></path>
      <path d="M13 12h8"></path>
      <path d="M13 19h8"></path>
      <path d="m3 17 2 2 4-4"></path>
      <path d="m3 7 2 2 4-4"></path>
    </svg>
  );
}
