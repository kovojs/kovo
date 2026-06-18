import { defineConfig, node } from '@kovojs/server/build';
// import { cloudflare, vercel } from '@kovojs/server/build';

export default defineConfig({
  preset: node(),
  // Deploy to Vercel:
  // preset: vercel(),
  // Deploy to Cloudflare Workers with nodejs_compat:
  // preset: cloudflare(),
});
