/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Pill icon (Lucide). https://lucide.dev/icons/pill */
export function Pill(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path>
      <path d="m8.5 8.5 7 7"></path>
    </svg>
  );
}
