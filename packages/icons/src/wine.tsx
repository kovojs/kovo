/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Wine icon (Lucide). https://lucide.dev/icons/wine */
export function Wine(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 22h8"></path>
      <path d="M7 10h10"></path>
      <path d="M12 15v7"></path>
      <path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"></path>
    </svg>
  );
}
