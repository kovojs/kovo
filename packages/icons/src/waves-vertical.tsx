/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Waves Vertical icon (Lucide). https://lucide.dev/icons/waves-vertical */
export function WavesVertical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 2q2 2.5 0 5t0 5 0 5 0 5"></path>
      <path d="M19 2q2 2.5 0 5t0 5 0 5 0 5"></path>
      <path d="M5 2q2 2.5 0 5t0 5 0 5 0 5"></path>
    </svg>
  );
}
