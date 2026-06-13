import assert from 'node:assert/strict';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { runInNewContext } from 'node:vm';

export interface CommandInvocation {
  args: readonly string[];
  argv: readonly string[];
  executable: string;
  raw: string;
}

export interface PnpmFilterTestCommand {
  argv: readonly string[];
  packageName: string;
  script: 'test';
}

export interface VitestTaskCommand {
  configPath: string;
}

export interface NodeTaskCommand {
  modulePath: string;
}

export interface WorkflowStepCommand {
  run?: string;
  uses?: string;
}

export interface VitePlusTask {
  command?: unknown;
  input?: unknown;
  output?: unknown;
}

export interface VitePlusConfig {
  run?: {
    tasks?: Record<string, VitePlusTask>;
  };
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') assert.fail(message);
  return value;
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function workflowStepCommands(source: string): WorkflowStepCommand[] {
  const steps: WorkflowStepCommand[] = [];

  for (const line of source.split('\n')) {
    const match = /^\s*-\s+(run|uses):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const kind = match[1];
    const value = match[2];
    if ((kind === 'run' || kind === 'uses') && value !== undefined) {
      steps.push({ [kind]: value });
    }
  }

  return steps;
}

export function workflowVpRunTaskNames(source: string): string[] {
  return workflowStepCommands(source)
    .map((step) => vpRunTaskName(step.run ?? ''))
    .filter((taskName): taskName is string => Boolean(taskName));
}

export function pnpmRunScriptName(command: string): string | undefined {
  const match = /^pnpm run ([\w:-]+)$/.exec(command);
  return match?.[1];
}

export function pnpmRunScriptNames(command: unknown): string[] {
  const commandText = requireString(command, 'pnpm run script list is present');
  return commandText.split(' && ').map((entry) => {
    const scriptName = pnpmRunScriptName(entry);
    assert.ok(scriptName, `pnpm run script entry is structured: ${entry}`);
    return scriptName;
  });
}

export function vpRunTaskName(command: string): string | undefined {
  const match = /^vp run ([\w-]+)$/.exec(command);
  return match?.[1];
}

export function requiredVpRunTaskName(
  scriptName: string,
  packageJson: { scripts?: Record<string, unknown> },
): string {
  const command = requireString(packageJson.scripts?.[scriptName], `${scriptName} script exists`);
  const taskName = vpRunTaskName(command);
  assert.ok(taskName, `${scriptName} delegates to a Vite+ task`);
  return taskName;
}

export function assertOrderedItems(items: readonly string[], before: string, after: string): void {
  const beforeIndex = items.indexOf(before);
  const afterIndex = items.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${before} is present`);
  assert.notEqual(afterIndex, -1, `${after} is present`);
  assert.ok(beforeIndex < afterIndex, `${before} precedes ${after}`);
}

export async function loadVitePlusConfig(source: string): Promise<VitePlusConfig> {
  const ts = await import('typescript');
  const module = { exports: {} as { default?: VitePlusConfig } };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  runInNewContext(compiled, {
    exports: module.exports,
    module,
    require(specifier: string) {
      if (specifier === 'vite-plus') {
        return { defineConfig: (config: VitePlusConfig) => config };
      }
      if (specifier === '@tailwindcss/vite') {
        const tailwindcss = () => ({ name: 'tailwindcss-test-stub' });
        tailwindcss.default = tailwindcss;
        tailwindcss.__esModule = true;
        return tailwindcss;
      }
      assert.fail(`unexpected Vite+ config import ${specifier}`);
    },
  });

  return jsonClone(module.exports.default ?? {});
}

export function vitestTaskCommand(command: unknown): VitestTaskCommand {
  const commandText = requireString(command, 'Vitest task command is present');
  const parts = commandText.split(/\s+/);
  assert.equal(parts[0], 'vitest');
  assert.equal(parts.includes('--run'), true);
  const configIndex = parts.indexOf('--config');
  assert.notEqual(configIndex, -1);
  const configPath = parts[configIndex + 1];
  assert.ok(configPath, 'Vitest task names a config file');
  return { configPath };
}

export function nodeTaskCommand(command: unknown): NodeTaskCommand {
  const commandText = requireString(command, 'Node task command is present');
  const match = /^node ([^\s]+)$/.exec(commandText);
  assert.ok(match, 'Node task runs a single module entrypoint');
  const modulePath = match[1];
  assert.ok(modulePath, 'Node task names a module entrypoint');
  return { modulePath };
}

export function pnpmFilterTestCommands(command: unknown): PnpmFilterTestCommand[] {
  assert.equal(typeof command, 'string', 'pnpm filter task command is present');
  return commandSequence(command).map(({ args, executable, raw }) => {
    assert.equal(executable, 'pnpm');
    assert.equal(args.length, 3, `pnpm filter test command has three args: ${raw}`);
    assert.equal(args[0], '--filter');
    assert.equal(args[2], 'test');
    const packageName = args[1];
    assert.ok(packageName, `pnpm filter test command names a package: ${raw}`);
    return { argv: [executable, ...args], packageName, script: 'test' };
  });
}

export function commandSequence(command: unknown): CommandInvocation[] {
  const commandText = requireString(command, 'task command is present');
  return commandText.split(' && ').map((raw) => {
    const parts = raw.split(/\s+/).filter(Boolean);
    assert.notEqual(parts.length, 0, `task command entry is not empty: ${raw}`);
    assert.equal(
      parts.every((part) => /^[./:@\w-]+$/.test(part)),
      true,
      `task command avoids shell syntax: ${raw}`,
    );
    const executable = parts[0];
    assert.ok(executable, `task command names an executable: ${raw}`);
    return { args: parts.slice(1), argv: parts, executable, raw };
  });
}

export function commandSequenceWithoutLast(command: unknown): string {
  const commands = commandSequence(command);
  assert.ok(commands.length > 1, 'task command has more than one entry');
  return commands
    .slice(0, -1)
    .map(({ raw }) => raw)
    .join(' && ');
}

export function runCommandSequenceSync(command: unknown, options: ExecFileSyncOptions): string {
  return commandSequence(command)
    .map(({ args, executable }) => execFileSync(executable, [...args], options))
    .join('');
}
