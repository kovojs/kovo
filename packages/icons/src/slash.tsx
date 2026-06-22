/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Slash icon (Lucide). https://lucide.dev/icons/slash */
export function Slash(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 2 2 22"></path>
    </svg>
  );
}
