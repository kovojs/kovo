/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Signal Zero icon (Lucide). https://lucide.dev/icons/signal-zero */
export function SignalZero(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 20h.01"></path>
    </svg>
  );
}
