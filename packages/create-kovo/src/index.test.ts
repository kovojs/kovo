import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { kovoDocsMirrorRemotes } from '@kovojs/core/internal/agent-docs';
import { describe, expect, it, vi } from 'vitest';

import { createKovoProject, demoPasswordEnvVar, main, writeKovoProject } from './index.js';

const TEMPLATE_FILES = [
  'package.json',
  'tsconfig.json',
  'kovo.config.ts',
  'vite.config.ts',
  '.github/workflows/ci.yml',
  'README.md',
  'scripts/check-sound-subset.mjs',
  'src/schema.ts',
  'src/db.ts',
  'src/auth.ts',
  'src/queries.ts',
  'src/mutations.ts',
  'src/components/contacts.tsx',
  'src/components/auth-forms.tsx',
  'src/app.tsx',
  'src/app.test.ts',
  'src/theme.ts',
  'src/styles.css',
];
const AGENT_DOC_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  ...kovoDocsMirrorRemotes.map((remote) => `.kovo/docs/${remote.path}`),
  '.kovo/docs/metadata.json',
];
const GENERATED_FILES = [...AGENT_DOC_FILES, '.env', '.env.example', '.gitignore'];
const ALL_FILES = [...AGENT_DOC_FILES, ...TEMPLATE_FILES, '.env', '.env.example', '.gitignore'];
const SQLITE_TEMPLATE_FILES = [
  'package.sqlite.json',
  'README.sqlite.md',
  'src/schema.sqlite.ts',
  'src/db.sqlite.ts',
  'src/auth.sqlite.ts',
];

describe('create-kovo starter (metadata)', () => {
  it('scaffolds the real template file set with no unrendered placeholders', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-scaffold-'));

    try {
      const templateUrl = new URL('../templates/', import.meta.url);
      for (const file of TEMPLATE_FILES) {
        expect(existsSync(new URL(file, templateUrl))).toBe(true);
      }
      for (const file of SQLITE_TEMPLATE_FILES) {
        expect(existsSync(new URL(file, templateUrl))).toBe(true);
      }

      const result = writeKovoProject(root, { name: 'My App' });
      expect(result).toEqual({ files: ALL_FILES, name: 'my-app', root });

      for (const file of TEMPLATE_FILES) {
        const source = readFileSync(join(root, file), 'utf8');
        expect(source).not.toContain('{{');
        expect(source).not.toContain('}}');
      }

      const project = createKovoProject({ name: 'My App' });
      expect(project.name).toBe('my-app');
      expect(project.files.map((file) => file.path)).toEqual(ALL_FILES);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('scaffolds local agent docs and points CLAUDE.md at AGENTS.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-agents-'));

    try {
      writeKovoProject(root, { name: 'Agent Docs' });

      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('# Agent Instructions');
      expect(agents).toContain('<!-- BEGIN:kovo-rules -->');
      expect(agents).toContain('<!-- kovo-rules-version: 0.1.1 -->');
      expect(agents).toContain('`kovo check`');
      expect(agents).toContain('Read the local docs below');
      expect(agents).toContain('- Spec: `./.kovo/docs/spec.md`');
      expect(agents).toContain('### Guides');
      expect(agents).toContain('- Live queries: `./.kovo/docs/guides/live-queries.md`');
      expect(agents).not.toContain('./.kovo/docs/llms.txt');
      expect(agents).not.toContain('./.kovo/docs/llms-full.txt');
      expect(agents).toContain('<!-- END:kovo-rules -->');

      expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md');
      expect(realpathSync(join(root, 'CLAUDE.md'))).toBe(realpathSync(join(root, 'AGENTS.md')));

      expect(readFileSync(join(root, '.kovo/docs/kovo-rules.md'), 'utf8')).toContain('## Commands');
      expect(readFileSync(join(root, '.kovo/docs/llms.txt'), 'utf8')).toContain(
        'Compact local docs index',
      );
      const metadata = JSON.parse(readFileSync(join(root, '.kovo/docs/metadata.json'), 'utf8')) as {
        source?: string;
        version?: string;
      };
      expect(metadata).toMatchObject({ source: 'bundled', version: '0.1.1' });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('declares the building-block dependencies and the lean script set', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-pkg-'));

    try {
      writeKovoProject(root, { name: 'My App' });
      const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        name?: string;
        packageManager?: string;
        scripts?: Record<string, string>;
      };

      expect(packageJson.name).toBe('my-app');
      expect(packageJson.dependencies).toMatchObject({
        '@electric-sql/pglite': expect.any(String),
        '@kovojs/better-auth': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/core': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/drizzle': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/server': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/style': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/ui': expect.stringMatching(/^\d+\.\d+\.\d+/),
        'better-auth': expect.any(String),
        'drizzle-orm': expect.any(String),
      });
      expect(Object.values(packageJson.dependencies ?? {})).not.toContain('workspace:*');
      expect(Object.values(packageJson.devDependencies ?? {})).not.toContain('workspace:*');
      expect(packageJson.packageManager).toBe('pnpm@10.12.1');
      expect(packageJson.dependencies).not.toHaveProperty('better-sqlite3');
      expect(packageJson.devDependencies).toMatchObject({
        '@kovojs/cli': expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
      expect(packageJson.devDependencies).not.toHaveProperty('@kovojs/compiler');
      expect(packageJson.scripts).toMatchObject({
        'build:prod': 'kovo build ./src/app.tsx',
        check: 'vp check && npm run check:sound-subset',
        'check:sound-subset': 'node scripts/check-sound-subset.mjs',
        dev: 'vp dev',
        serve: 'npm run build:prod && node dist/server/server.mjs',
        start: 'node dist/server/server.mjs',
        test: 'vp test',
      });
      // Removed fiction/wrapper scripts are gone.
      expect(packageJson.scripts).not.toHaveProperty('emit-graph');
      expect(packageJson.scripts).not.toHaveProperty('static');
      expect(packageJson.scripts).not.toHaveProperty('serve:dev');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps Postgres as the default scaffold dialect', () => {
    const project = createKovoProject({ name: 'Default Dialect' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));

    expect(files.get('package.json')).toContain('"@electric-sql/pglite"');
    expect(files.get('package.json')).not.toContain('"better-sqlite3"');
    expect(files.get('src/db.ts')).toContain("import { PGlite } from '@electric-sql/pglite'");
    expect(files.get('src/schema.ts')).toContain('import { boolean, pgTable, text, timestamp }');
    expect(files.get('src/auth.ts')).toContain("provider: 'pg'");
  });

  it('emits SPEC §6.6 sound-subset policy and framework anonymous CSRF binding', () => {
    const project = createKovoProject({ name: 'Policy Proof' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));

    expect(files.get('tsconfig.json')).toContain('"strict": true');
    expect(files.get('tsconfig.json')).toContain('"noUncheckedIndexedAccess": true');
    expect(files.get('scripts/check-sound-subset.mjs')).toContain(
      'SPEC.md §6.6 sound subset bans any',
    );
    expect(files.get('src/auth.ts')).toContain(
      'return request.session?.id ?? request.authCsrfId ?? undefined;',
    );
    expect(files.get('src/auth.ts')).not.toContain('kovo-starter-anon');
  });

  it('emits the SQLite scaffold variant when requested', () => {
    const project = createKovoProject({ dialect: 'sqlite', name: 'Sqlite App' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));

    expect(files.get('package.json')).toContain('"better-sqlite3"');
    expect(files.get('package.json')).not.toContain('"@electric-sql/pglite"');
    expect(files.get('src/db.ts')).toContain("import Database from 'better-sqlite3'");
    expect(files.get('src/db.ts')).toContain("from 'drizzle-orm/better-sqlite3'");
    expect(files.get('src/db.ts')).toContain('"emailVerified" integer NOT NULL DEFAULT 0');
    expect(files.get('src/schema.ts')).toContain('import { integer, sqliteTable, text }');
    expect(files.get('src/schema.ts')).toContain("integer('emailVerified', { mode: 'boolean' })");
    expect(files.get('src/schema.ts')).not.toContain('timestamp(');
    expect(files.get('src/auth.ts')).toContain("provider: 'sqlite'");
    expect(files.get('README.md')).toContain('opt-in SQLite dialect');
  });

  it('uses the public Kovo Vite plugin instead of a hand-rolled dev loader', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-vite-'));

    try {
      writeKovoProject(root, { name: 'My App' });
      const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain("import { kovo } from '@kovojs/server/vite'");
      expect(viteConfig).toContain("kovo({ app: '/src/app.tsx' })");
      expect(viteConfig).not.toContain('ssrLoadModule');
      expect(viteConfig).not.toContain('starterSharedAppShellDevPlugin');

      const appSource = readFileSync(join(root, 'src/app.tsx'), 'utf8');
      // Idiomatic TSX, not hand-authored lowered IR (SPEC.md §5.2 / KV235).
      expect(appSource).toContain('@jsxImportSource @kovojs/server');
      expect(appSource).toContain('createApp(');
      expect(appSource).not.toContain('/c/__v/');
      expect(appSource).not.toContain('Starter$announce');

      // No fake graph apparatus or static-export wrappers remain.
      expect(existsSync(join(root, 'scripts/check-sound-subset.mjs'))).toBe(true);
      expect(existsSync(join(root, 'docs'))).toBe(false);
      expect(existsSync(join(root, '.kovo/docs/llms.txt'))).toBe(true);
      expect(existsSync(join(root, 'src/app-shell.ts'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes deterministic files plus a fresh per-project secret', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-det-'));

    try {
      const result = writeKovoProject(root, { name: 'Example App' });
      const project = createKovoProject({ name: 'Example App' });

      expect(result).toEqual({
        files: project.files.map((file) => file.path),
        name: 'example-app',
        root,
      });

      for (const file of project.files) {
        if (file.path === '.env') continue;
        if (file.symlinkTarget) {
          expect(readlinkSync(join(root, file.path))).toBe(file.symlinkTarget);
          continue;
        }
        expect(readFileSync(join(root, file.path), 'utf8')).toBe(file.source);
      }

      const envSource = readFileSync(join(root, '.env'), 'utf8');
      const secret = /^KOVO_CSRF_SECRET=(.+)$/m.exec(envSource)?.[1] ?? '';
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(secret).not.toBe('replace-with-a-deployed-secret');
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(envSource)?.[1] ?? '';
      expect(demoPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(demoPassword).not.toBe('password123');

      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_CSRF_SECRET=replace-with-a-deployed-secret',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_DEMO_PASSWORD=replace-with-a-local-demo-password',
      );
      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.env');
      expect(gitignore).not.toContain('graph.json');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('create-kovo starter (build integration)', () => {
  it('typechecks the generated app with starter dependencies', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-tsc-'));

    try {
      writeKovoProject(root, { name: 'Tsc Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/schema.ts',
          'src/db.ts',
          'src/auth.ts',
          'src/queries.ts',
          'src/mutations.ts',
          'src/components/contacts.tsx',
          'src/components/auth-forms.tsx',
          'src/app.tsx',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('typechecks the generated SQLite app variant', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-sqlite-tsc-'));

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Sqlite Tsc Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/schema.ts',
          'src/db.ts',
          'src/auth.ts',
          'src/queries.ts',
          'src/mutations.ts',
          'src/components/contacts.tsx',
          'src/components/auth-forms.tsx',
          'src/app.tsx',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs the generated in-app tests (data layer + request shell)', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-vitest-'));

    try {
      writeKovoProject(root, { name: 'Vitest Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vitest'), ['--run', 'src/app.test.ts'], {
        cwd: root,
        stdio: 'pipe',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);

  it('serves the generated app through vp dev (redirect + login + styles)', async () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-dev-'));
    const port = await reservePort();
    let devServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Dev Proof' });
      linkStarterBuildDependencies(root);

      devServer = spawn(
        resolveBin('vp'),
        ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd: root, detached: process.platform !== 'win32', env: withRepoBinOnPath() },
      );
      const output = collectOutput(devServer);
      const origin = `http://127.0.0.1:${port}`;

      const login = await fetchTextWhenReady(`${origin}/login`, output);
      expect(login).toContain('Sign in');
      // The themed stylesheet pipeline ran: critical theme vars are inlined.
      expect(login).toContain('--kovo-theme');

      const home = await fetch(`${origin}/`, { redirect: 'manual' });
      expect([302, 303, 307]).toContain(home.status);
      // The `/` route's KV436 access guard (SPEC §10.2) redirects an unauthenticated
      // visitor to the login route, carrying `next` so sign-in returns them home.
      expect(home.headers.get('location')).toBe('/login?next=%2F');

      // Full real-auth round trip: the seeded demo account signs in (CSRF token +
      // Better Auth over PGlite), and the guarded home page then renders the
      // contact list and add-contact form.
      const jar = new Map<string, string>();
      const loginResponse = await fetch(`${origin}/login`);
      mergeCookies(jar, loginResponse.headers.getSetCookie());
      const csrf = /name="csrf"\s+value="([^"]+)"/.exec(await loginResponse.text())?.[1];
      expect(csrf).toBeTruthy();
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
          readFileSync(join(root, '.env'), 'utf8'),
        )?.[1] ?? '';
      expect(demoPassword).toBeTruthy();

      const form = new URLSearchParams({
        email: 'demo@example.com',
        password: demoPassword,
        next: '/',
        csrf: csrf ?? '',
      });
      const signIn = await fetch(`${origin}/_m/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
        body: form.toString(),
        redirect: 'manual',
      });
      mergeCookies(jar, signIn.headers.getSetCookie());
      expect(signIn.status).toBe(303);

      const authedHome = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
        redirect: 'manual',
      });
      expect(authedHome.status).toBe(200);
      const authedHtml = await authedHome.text();
      expect(authedHtml).toContain('Demo User');
      expect(authedHtml).toContain('Contacts');
      expect(authedHtml).toContain('Ada Lovelace');
      expect(authedHtml).toContain('Add contact');
    } finally {
      await stopProcess(devServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 45_000);
});

describe('create-kovo starter (CLI)', () => {
  it('creates a new target directory and derives the package name', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-'));
    const root = join(parent, 'Hello CLI');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(
        `create-kovo: wrote ${ALL_FILES.length} files to ${root}\n`,
      );
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'hello-cli',
      });
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('accepts a SQLite dialect flag', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-sqlite-'));
    const root = join(parent, 'Hello SQLite');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root, '--dialect', 'sqlite'])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(
        `create-kovo: wrote ${ALL_FILES.length} files to ${root}\n`,
      );
      expect(readFileSync(join(root, 'src/auth.ts'), 'utf8')).toContain("provider: 'sqlite'");
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('writes CLI failure output to stderr while returning a non-zero exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-cli-error-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(join(root, 'README.md'), 'existing', 'utf8');
      expect(main([root])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(`create-kovo: Target directory is not empty: ${root}\n`);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('refuses to write into a non-empty target directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-collision-'));
    writeFileSync(join(root, 'README.md'), 'existing', 'utf8');

    try {
      expect(() => writeKovoProject(root, { name: 'Collision' })).toThrow(
        `Target directory is not empty: ${root}`,
      );
      expect(existsSync(join(root, 'package.json'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function linkStarterBuildDependencies(root: string): void {
  const nodeModules = join(root, 'node_modules');
  const nodeModulesBin = join(nodeModules, '.bin');
  mkdirSync(join(nodeModules, '@kovojs'), { recursive: true });
  mkdirSync(join(nodeModules, '@electric-sql'), { recursive: true });
  mkdirSync(join(nodeModules, '@types'), { recursive: true });
  mkdirSync(nodeModulesBin, { recursive: true });

  symlinkSync(join(resolveDependencyRoot('kovo'), 'src/bin.ts'), join(nodeModulesBin, 'kovo'));
  symlinkSync(join(resolveDependencyRoot('vite-plus'), 'bin/vp'), join(nodeModulesBin, 'vp'));
  symlinkSync(resolveDependencyRoot('@types/node'), join(nodeModules, '@types/node'));
  symlinkSync(
    resolveDependencyRoot('@types/better-sqlite3'),
    join(nodeModules, '@types/better-sqlite3'),
  );

  for (const pkg of [
    '@kovojs/better-auth',
    '@kovojs/browser',
    '@kovojs/core',
    '@kovojs/drizzle',
    '@kovojs/server',
    '@kovojs/style',
    '@kovojs/ui',
    '@kovojs/cli',
  ]) {
    symlinkSync(resolveDependencyRoot(pkg), join(nodeModules, pkg));
  }
  symlinkSync(
    resolveDependencyRoot('@electric-sql/pglite'),
    join(nodeModules, '@electric-sql/pglite'),
  );
  for (const pkg of [
    'better-auth',
    'better-sqlite3',
    'drizzle-orm',
    'kovo',
    'vite',
    'vitest',
    'vite-plus',
  ]) {
    symlinkSync(resolveDependencyRoot(pkg), join(nodeModules, pkg));
  }
}

function mergeCookies(jar: Map<string, string>, setCookies: readonly string[]): void {
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function withRepoBinOnPath(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [join(process.cwd(), 'node_modules/.bin'), process.env.PATH ?? ''].join(':'),
  };
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (typeof address !== 'object' || address === null) {
    throw new Error('Unable to reserve a TCP port.');
  }
  return address.port;
}

function collectOutput(process: ChildProcessWithoutNullStreams): () => string {
  const chunks: Buffer[] = [];
  process.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  process.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString('utf8');
}

async function fetchTextWhenReady(url: string, output: () => string): Promise<string> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) return body;
      lastError = new Error(`HTTP ${response.status}: ${body}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out fetching ${url}: ${cause}\n${output()}`);
}

async function stopProcess(
  childProcess: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (!childProcess || childProcess.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      killProcessTree(childProcess, 'SIGKILL');
      reject(new Error('Timed out stopping process.'));
    }, 5_000);
    childProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    killProcessTree(childProcess, 'SIGTERM');
  });
}

function killProcessTree(
  childProcess: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (childProcess.pid === undefined) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-childProcess.pid, signal);
      return;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }
  childProcess.kill(signal);
}

function resolveDependencyRoot(packageName: string): string {
  const dependencyRoot = join(process.cwd(), 'node_modules');
  const linkedPackageJson = join(dependencyRoot, packageName, 'package.json');
  if (existsSync(linkedPackageJson)) {
    return realpathSync(dirname(linkedPackageJson));
  }

  if (packageName.startsWith('@kovojs/')) {
    const workspacePackageJson = join(
      process.cwd(),
      'packages',
      packageName.slice('@kovojs/'.length),
      'package.json',
    );
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  if (packageName === 'kovo') {
    const workspacePackageJson = join(process.cwd(), 'packages/cli/package.json');
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  const pnpmStore = findPnpmStore(dependencyRoot);
  if (pnpmStore) {
    for (const entry of readdirSync(pnpmStore)) {
      const packageJson = join(pnpmStore, entry, 'node_modules', packageName, 'package.json');
      if (existsSync(packageJson)) {
        return realpathSync(dirname(packageJson));
      }
    }
  }

  throw new Error(`Unable to resolve generated starter dependency: ${packageName}`);
}

function findPnpmStore(start: string): string | undefined {
  let current = start;
  while (true) {
    for (const candidate of [join(current, '.pnpm'), join(current, 'node_modules/.pnpm')]) {
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolveBin(name: string): string {
  let current = process.cwd();
  while (true) {
    for (const candidate of [
      join(current, 'node_modules/.bin', name),
      join(current, 'node_modules/.pnpm/node_modules/.bin', name),
    ]) {
      if (existsSync(candidate)) {
        return realpathSync(candidate);
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to resolve binary: ${name}`);
}
