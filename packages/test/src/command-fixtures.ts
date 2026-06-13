import assert from 'node:assert/strict';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';

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

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') assert.fail(message);
  return value;
}

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

export function runCommandSequenceSync(command: unknown, options: ExecFileSyncOptions): string {
  return commandSequence(command)
    .map(({ args, executable }) => execFileSync(executable, [...args], options))
    .join('');
}
