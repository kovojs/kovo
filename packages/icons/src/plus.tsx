/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Plus icon (Lucide). https://lucide.dev/icons/plus */
export function Plus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M5 12h14"></path>
      <path d="M12 5v14"></path>
    </svg>
  );
}
