import { defineConfig, node } from '@kovojs/server/build';
// import { cloudflare, vercel } from '@kovojs/server/build';

export default defineConfig({
  preset: node(),
  // If your deploy keeps prior /c/__v/... modules and prior-token /_q reads available for at least
  // 24 hours, declare the SPEC §14 retention proof so client islands can ship:
  // preset: node({
  //   retention: {
  //     hours: 24,
  //     immutableClientModules: 'retained',
  //     priorTokenQueryReads: 'retained',
  //   },
  // }),
  // Deploy to Vercel:
  // preset: vercel(),
  // Deploy to Cloudflare Workers with nodejs_compat:
  // preset: cloudflare(),
});
