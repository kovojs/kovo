import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const actionPath = path.join(repositoryRoot, '.github/actions/playwright-install/action.yml');
const installerPath = path.join(repositoryRoot, '.github/actions/playwright-install/install.sh');
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function executable(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-playwright-install-'));
  temporaryRoots.push(root);
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const log = path.join(root, 'commands.log');
  const counter = path.join(root, 'attempts');
  mkdirSync(bin);
  mkdirSync(home);

  executable(
    path.join(bin, 'sudo'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'sudo' >> "$FAKE_COMMAND_LOG"
printf ' <%s>' "$@" >> "$FAKE_COMMAND_LOG"
printf '\n' >> "$FAKE_COMMAND_LOG"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive | --preserve-env | --user=*) shift ;;
    *) break ;;
  esac
done
exec "$@"
`,
  );
  executable(
    path.join(bin, 'timeout'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == --version ]]; then
  printf '%s\n' "\${FAKE_TIMEOUT_VERSION:-timeout (GNU coreutils) 9.4}"
  exit 0
fi
printf 'timeout' >> "$FAKE_COMMAND_LOG"
printf ' <%s>' "$@" >> "$FAKE_COMMAND_LOG"
printf '\n' >> "$FAKE_COMMAND_LOG"
joined=" $* "
if [[ "$joined" == *" playwright install --with-deps "* ]]; then
  attempt=0
  if [[ -f "$FAKE_ATTEMPT_COUNTER" ]]; then
    read -r attempt < "$FAKE_ATTEMPT_COUNTER"
  fi
  printf '%d\n' "$((attempt + 1))" > "$FAKE_ATTEMPT_COUNTER"
  IFS=',' read -r -a statuses <<< "\${FAKE_INSTALL_STATUSES:-0}"
  if ((attempt >= \${#statuses[@]})); then
    attempt="$((\${#statuses[@]} - 1))"
  fi
  exit "\${statuses[$attempt]}"
fi
if [[ "$joined" == *" dpkg --configure -a "* ]]; then
  exit "\${FAKE_CLEANUP_STATUS:-0}"
fi
printf 'unexpected timeout command: %s\n' "$*" >&2
exit 90
`,
  );
  executable(
    path.join(bin, 'sleep'),
    `#!/usr/bin/env bash
printf 'sleep <%s>\n' "$*" >> "$FAKE_COMMAND_LOG"
`,
  );
  executable(
    path.join(bin, 'vp'),
    `#!/usr/bin/env bash
printf 'vp-executed-unexpectedly <%s>\n' "$*" >> "$FAKE_COMMAND_LOG"
exit 91
`,
  );

  return { bin, counter, home, log, root };
}

function runInstaller(browsers, options = {}) {
  const files = fixture();
  const cacheRoot = options.cacheRoot ?? path.join(files.home, '.cache/ms-playwright');
  if (options.locked) {
    mkdirSync(path.join(cacheRoot, '__dirlock'), { recursive: true });
  }
  const args = browsers === undefined ? [installerPath] : [installerPath, browsers];
  const result = spawnSync('bash', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_ATTEMPT_COUNTER: files.counter,
      FAKE_CLEANUP_STATUS: String(options.cleanupStatus ?? 0),
      FAKE_COMMAND_LOG: files.log,
      FAKE_INSTALL_STATUSES: options.statuses ?? '0',
      ...(options.timeoutVersion === undefined
        ? {}
        : { FAKE_TIMEOUT_VERSION: options.timeoutVersion }),
      HOME: files.home,
      PATH: `${files.bin}:${process.env.PATH ?? ''}`,
      ...(options.cacheRoot === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: options.cacheRoot }),
    },
    timeout: 5_000,
  });
  return {
    ...files,
    cacheRoot,
    commandLog: existsSync(files.log) ? readFileSync(files.log, 'utf8') : '',
    result,
  };
}

function declaredWorkflowBrowserSets() {
  const workflowDirectory = path.join(repositoryRoot, '.github/workflows');
  const browserSets = [];
  for (const name of readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/u.test(entry))) {
    const lines = readFileSync(path.join(workflowDirectory, name), 'utf8').split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes('uses: ./.github/actions/playwright-install')) continue;
      const input = lines.slice(index + 1, index + 8).find((line) => /^\s+browsers: /u.test(line));
      expect(input, `${name}:${String(index + 1)}`).toBeDefined();
      browserSets.push(input.trim().slice('browsers: '.length));
    }
  }
  return new Set(browserSets);
}

describe('Playwright install composite action', () => {
  it('keeps cache restore and the exact reviewed browser sets ahead of the bounded installer', () => {
    const action = readFileSync(actionPath, 'utf8');
    expect(declaredWorkflowBrowserSets()).toEqual(
      new Set(['chromium', 'firefox webkit', 'chromium firefox webkit']),
    );
    expect(action).toContain('actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830');
    expect(action).toContain('path: ~/.cache/ms-playwright');
    expect(action.indexOf('Restore Playwright browser cache')).toBeLessThan(
      action.indexOf('Install Playwright browsers'),
    );
    expect(action).toContain('PLAYWRIGHT_INSTALL_BROWSERS: ${{ inputs.browsers }}');
    expect(action).toContain('"$GITHUB_ACTION_PATH/install.sh" "$PLAYWRIGHT_INSTALL_BROWSERS"');
  });

  it('removes only the degraded Azure mirror when the canonical archive fallback exists', () => {
    const action = readFileSync(actionPath, 'utf8');
    expect(action).toContain('mirror_file=/etc/apt/apt-mirrors.txt');
    expect(action).toContain('azure\\.archive\\.ubuntu\\.com/ubuntu');
    const fallbackGuard =
      "grep -Eq '^[[:space:]]*https?://archive\\.ubuntu\\.com/ubuntu/?([[:space:]]|$)'";
    expect(action).toContain(fallbackGuard);
    expect(action).toContain('sudo sed -i -E');
    expect(action.indexOf(fallbackGuard)).toBeLessThan(action.indexOf('sudo sed -i -E'));

    const sedExpression = action.match(/sudo sed -i -E '([^']+)'/u)?.[1];
    expect(sedExpression).toBeDefined();
    const transformed = spawnSync('sed', ['-E', sedExpression], {
      encoding: 'utf8',
      input:
        'http://azure.archive.ubuntu.com/ubuntu/ priority:1\n' +
        'https://archive.ubuntu.com/ubuntu/ priority:2\n' +
        'https://security.ubuntu.com/ubuntu/ priority:3\n',
    });
    expect(transformed.status, transformed.stderr).toBe(0);
    expect(transformed.stdout).toBe(
      'https://archive.ubuntu.com/ubuntu/ priority:2\n' +
        'https://security.ubuntu.com/ubuntu/ priority:3\n',
    );
  });

  it('rejects missing, malformed, reordered, and shell-shaped browser inputs before execution', () => {
    for (const browsers of [
      undefined,
      '',
      'webkit firefox',
      'chromium firefox',
      'chromium  firefox webkit',
      'chromium; touch should-not-run',
    ]) {
      const { commandLog, result } = runInstaller(browsers);
      expect(result.status, browsers).toBe(64);
      expect(result.stderr, browsers).toContain('playwright-install:');
      expect(commandLog, browsers).toBe('');
    }
  });

  it.each(['chromium', 'firefox webkit', 'chromium firefox webkit'])(
    'passes the closed %s browser set as distinct arguments and exits after first success',
    (browsers) => {
      const { bin, commandLog, result } = runInstaller(browsers);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const installs = commandLog
        .split('\n')
        .filter((line) => line.startsWith('timeout') && line.includes('playwright'));
      expect(installs).toHaveLength(1);
      const lines = commandLog.trim().split('\n');
      expect(lines[0]).toContain(`<${path.join(bin, 'timeout')}>`);
      expect(lines[1]).toContain(
        `<${path.join(bin, 'sudo')}> <--non-interactive> <--preserve-env> <--user=#${String(
          process.getuid?.() ?? process.geteuid?.(),
        )}>`,
      );
      expect(installs[0]).toContain('<exec> <playwright> <install> <--with-deps>');
      for (const browser of browsers.split(' ')) expect(installs[0]).toContain(`<${browser}>`);
      expect(commandLog).not.toContain('<dpkg> <--configure> <-a>');
      expect(commandLog).not.toContain('sleep <');
    },
  );

  it('fails before sudo when timeout is not the required GNU implementation', () => {
    const { commandLog, result } = runInstaller('chromium', {
      timeoutVersion: 'incompatible timeout',
    });
    expect(result.status).toBe(69);
    expect(result.stderr).toContain('GNU timeout is required');
    expect(commandLog).toBe('');
  });

  it('recovers a timed-out attempt, removes the exact stale lock, backs off, and retries once', () => {
    const { commandLog, home, result } = runInstaller('chromium', {
      locked: true,
      statuses: '124,0',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(
      commandLog
        .split('\n')
        .filter((line) => line.startsWith('timeout') && line.includes('playwright')),
    ).toHaveLength(2);
    expect(commandLog).toContain('<dpkg> <--configure> <-a>');
    expect(commandLog).toContain('sleep <15>');
    expect(existsSync(path.join(home, '.cache/ms-playwright/__dirlock'))).toBe(false);
    expect(result.stderr).toContain('exited 124; recovering before retry');
  });

  it('keeps cleanup bounded, retries after cleanup failure, and preserves the last install exit', () => {
    const { commandLog, result } = runInstaller('firefox webkit', {
      cleanupStatus: 124,
      statuses: '124,42',
    });
    expect(result.status).toBe(42);
    expect(result.stderr).toContain('Bounded dpkg recovery did not complete successfully');
    expect(result.stderr).toContain('failed after 2 bounded attempts (last exit 42)');
    const cleanup = commandLog
      .split('\n')
      .find((line) => line.startsWith('timeout') && line.includes('dpkg'));
    expect(cleanup).toContain('<--verbose> <--signal=TERM> <--kill-after=10s> <60s>');
  });

  it('cleans only an absolute non-root Playwright cache lock before retrying', () => {
    for (const cacheRoot of ['relative-cache', '/']) {
      const { commandLog, result } = runInstaller('chromium', {
        cacheRoot,
        statuses: '124,0',
      });
      expect(result.status, cacheRoot).toBe(65);
      expect(result.stderr, cacheRoot).toContain(
        cacheRoot === '/'
          ? 'refusing to clean a Playwright lock beneath /'
          : 'Playwright browser cache must be an absolute path',
      );
      expect(
        commandLog
          .split('\n')
          .filter((line) => line.startsWith('timeout') && line.includes('playwright')),
        cacheRoot,
      ).toHaveLength(1);
      expect(commandLog, cacheRoot).not.toContain('<dpkg> <--configure> <-a>');
      expect(commandLog, cacheRoot).not.toContain('sleep <');
    }

    const safeParent = mkdtempSync(path.join(tmpdir(), 'kovo-safe-playwright-cache-'));
    temporaryRoots.push(safeParent);
    const safeRoot = path.join(safeParent, 'cache');
    const safe = runInstaller('chromium', {
      cacheRoot: safeRoot,
      locked: true,
      statuses: '124,0',
    });
    expect(safe.result.status, safe.result.stderr).toBe(0);
    expect(existsSync(path.join(safeRoot, '__dirlock'))).toBe(false);
  });

  it('uses a privileged GNU TERM-to-KILL supervisor within both documented proof tails', () => {
    const installer = readFileSync(installerPath, 'utf8');
    const seconds = (name) =>
      Number(installer.match(new RegExp(`readonly ${name}=(\\d+)`, 'u'))?.[1]);
    const attempts = seconds('INSTALL_ATTEMPTS');
    const attempt = seconds('INSTALL_ATTEMPT_TIMEOUT_SECONDS');
    const kill = seconds('INSTALL_KILL_AFTER_SECONDS');
    const cleanup = seconds('CLEANUP_TIMEOUT_SECONDS');
    const cleanupKill = seconds('CLEANUP_KILL_AFTER_SECONDS');
    const backoff = seconds('RETRY_BACKOFF_SECONDS');
    const worstCaseSeconds = attempts * (attempt + kill) + cleanup + cleanupKill + backoff;

    expect(worstCaseSeconds).toBe(2_545);
    expect(90 * 60 - worstCaseSeconds - 16 * 60).toBeGreaterThanOrEqual(30 * 60);
    expect(120 * 60 - worstCaseSeconds - 44 * 60).toBeGreaterThanOrEqual(30 * 60);
    expect(installer).toContain('sudo_bin="$(command -v sudo)"');
    expect(installer).toContain('"$sudo_bin" --non-interactive --preserve-env');
    expect(installer).toContain('--kill-after="${INSTALL_KILL_AFTER_SECONDS}s"');
    expect(installer).toContain('--user="#${runner_uid}"');
    expect(installer).toContain('"$vp_bin" exec playwright install --with-deps');
    expect(installer).not.toContain('--foreground');
  });
});
