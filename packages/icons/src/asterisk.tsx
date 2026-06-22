/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Asterisk icon (Lucide). https://lucide.dev/icons/asterisk */
export function Asterisk(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6v12"></path>
      <path d="M17.196 9 6.804 15"></path>
      <path d="m6.804 9 10.392 6"></path>
    </svg>
  );
}
