// Compatibility entry for tooling that still imports /src/app.ts directly.
// The docs app itself is emitted as literal TSX routes in src/generated so
// @kovojs/compiler can derive route/page navigation metadata (SPEC §4.5).
export { default, siteNodeHandler, siteStaticExportApp } from './generated/app.kovo-route.js';
