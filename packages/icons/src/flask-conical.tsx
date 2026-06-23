/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Flask Conical icon (Lucide). https://lucide.dev/icons/flask-conical */
export function FlaskConical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"></path>
      <path d="M6.453 15h11.094"></path>
      <path d="M8.5 2h7"></path>
    </svg>
  );
}
