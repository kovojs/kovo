import assert from 'node:assert/strict';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

export interface VitePlusTaskInputFact {
  auto?: boolean;
  base?: string;
  pattern?: string;
}

export interface VitePlusAcceptanceTaskFacts {
  acceptanceScripts: readonly string[];
  ciTaskNames: readonly string[];
  presentInAcceptance: boolean;
  presentInCi: boolean;
  scriptName: string;
  task: VitePlusTask;
  taskName: string;
}

export interface BrowserSuiteAcceptanceShape {
  browser?: unknown;
  headless?: unknown;
  include?: unknown;
  providerPackage?: unknown;
}

export interface BrowserSuiteAcceptanceGateFact {
  acceptance: {
    browser: unknown;
    headless: unknown;
    include: unknown;
    providerPackage: unknown;
  };
  inputFacts: VitePlusTaskInputFact[];
  presentInAcceptance: boolean;
  presentInCi: boolean;
  scriptName: string;
  taskName: string;
}

export interface BrowserSuiteAcceptanceProjectFactOptions {
  ciWorkflowPath?: string;
  packageJsonPath?: string;
  rootPath: string;
  scriptName?: string;
  viteConfigPath?: string;
}

export type P10PerfAcceptanceProjectFactOptions = BrowserSuiteAcceptanceProjectFactOptions;

export interface P10PerfAcceptanceShape {
  browser?: unknown;
  cdpMethods?: unknown;
  heapNoiseBudget?: unknown;
  navigationCount?: unknown;
  paintEntry?: unknown;
  prerenderTimingField?: unknown;
  ttiMetric?: unknown;
}

export interface P10PerfAcceptanceGateFact {
  acceptance: {
    browser: unknown;
    cdpMethods: unknown;
    heapNoiseBudget: unknown;
    navigationCount: unknown;
    paintEntry: unknown;
    prerenderTimingField: unknown;
    ttiMetric: unknown;
  };
  inputFacts: VitePlusTaskInputFact[];
  ordering: {
    acceptanceAfterBuild: true;
    acceptanceBeforeFwCheck: true;
    ciAfterBuild: true;
    ciBeforeFwCheck: true;
  };
  presentInAcceptance: boolean;
  presentInCi: boolean;
  runFunction: boolean;
  scriptName: string;
  taskName: string;
}

export interface PackageManifestFact {
  directory: string;
  manifest: { name?: unknown; scripts?: Record<string, unknown> };
}

export interface ConformanceGateFacts {
  commands: PnpmFilterTestCommand[];
  everyCommandRunsTest: boolean;
  everyPackageHasTestScript: boolean;
  expectedPackages: Record<string, string>;
  inputFacts: VitePlusTaskInputFact[];
  packageEntries: Array<[string, unknown]>;
  packageNames: string[];
  presentInAcceptance: boolean;
  taskName: string;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') assert.fail(message);
  return value;
}

function firstString(value: unknown, message: string): string {
  assert.ok(Array.isArray(value), `${message} is an array`);
  const first = value[0];
  if (typeof first !== 'string') assert.fail(`${message} first entry is a string`);
  return first;
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

export function commandOutputLines(output: string): string[] {
  const normalized = output.trimEnd();
  return normalized.length === 0 ? [] : normalized.split(/\r?\n/);
}

export function vitePlusAcceptanceTaskFacts(options: {
  ciWorkflowSource: string;
  packageJson: { scripts?: Record<string, unknown> };
  scriptName: string;
  viteConfig: VitePlusConfig;
}): VitePlusAcceptanceTaskFacts {
  const acceptanceScripts = pnpmRunScriptNames(options.packageJson.scripts?.acceptance);
  const ciTaskNames = workflowVpRunTaskNames(options.ciWorkflowSource);
  const taskName = requiredVpRunTaskName(options.scriptName, options.packageJson);
  const task = options.viteConfig.run?.tasks?.[taskName];
  assert.ok(task, `${taskName} task is defined`);

  return {
    acceptanceScripts,
    ciTaskNames,
    presentInAcceptance: acceptanceScripts.includes(options.scriptName),
    presentInCi: ciTaskNames.includes(taskName),
    scriptName: options.scriptName,
    task,
    taskName,
  };
}

export function browserSuiteAcceptanceGateFact(options: {
  acceptance: BrowserSuiteAcceptanceShape;
  ciWorkflowSource: string;
  packageJson: { scripts?: Record<string, unknown> };
  scriptName?: string;
  viteConfig: VitePlusConfig;
}): BrowserSuiteAcceptanceGateFact {
  const scriptName = options.scriptName ?? 'test:browser';
  const gate = vitePlusAcceptanceTaskFacts({
    ciWorkflowSource: options.ciWorkflowSource,
    packageJson: options.packageJson,
    scriptName,
    viteConfig: options.viteConfig,
  });
  vitestTaskCommand(gate.task.command);
  vitePlusTaskInputPatternEndingWith(gate.task, '/browser-acceptance.mjs');
  const inputFacts = vitePlusTaskInputFacts(gate.task);
  const suiteInputFact = {
    base: 'workspace',
    pattern: firstString(options.acceptance.include, 'browser include'),
  };

  return {
    acceptance: {
      browser: options.acceptance.browser,
      headless: options.acceptance.headless,
      include: options.acceptance.include,
      providerPackage: options.acceptance.providerPackage,
    },
    inputFacts: inputFacts.some(
      (fact) => fact.base === suiteInputFact.base && fact.pattern === suiteInputFact.pattern,
    )
      ? inputFacts
      : [...inputFacts, suiteInputFact],
    presentInAcceptance: gate.presentInAcceptance,
    presentInCi: gate.presentInCi,
    scriptName: gate.scriptName,
    taskName: gate.taskName,
  };
}

export function browserSuiteAcceptanceModulePath(options: {
  packageJson: { scripts?: Record<string, unknown> };
  scriptName?: string;
  viteConfig: VitePlusConfig;
}): string {
  const scriptName = options.scriptName ?? 'test:browser';
  const taskName = requiredVpRunTaskName(scriptName, options.packageJson);
  const task = options.viteConfig.run?.tasks?.[taskName];
  assert.ok(task, `${taskName} task is defined`);
  vitestTaskCommand(task.command);
  return vitePlusTaskInputPatternEndingWith(task, '/browser-acceptance.mjs');
}

export async function browserSuiteAcceptanceProjectFact(
  options: BrowserSuiteAcceptanceProjectFactOptions,
): Promise<BrowserSuiteAcceptanceGateFact> {
  const { ciWorkflowSource, packageJson, viteConfig } = await projectAcceptanceGateInputs(options);
  const modulePathOptions = {
    packageJson,
    viteConfig,
    ...(options.scriptName === undefined ? {} : { scriptName: options.scriptName }),
  };
  const modulePath = browserSuiteAcceptanceModulePath(modulePathOptions);
  const imported = (await import(pathToFileURL(join(options.rootPath, modulePath)).href)) as {
    browserSuiteAcceptance?: BrowserSuiteAcceptanceShape;
  };

  assert.ok(imported.browserSuiteAcceptance, `${modulePath} exports browserSuiteAcceptance`);

  return browserSuiteAcceptanceGateFact({
    acceptance: imported.browserSuiteAcceptance,
    ciWorkflowSource,
    packageJson,
    viteConfig,
    ...(options.scriptName === undefined ? {} : { scriptName: options.scriptName }),
  });
}

async function projectAcceptanceGateInputs(
  options: BrowserSuiteAcceptanceProjectFactOptions,
): Promise<{
  ciWorkflowSource: string;
  packageJson: { scripts?: Record<string, unknown> };
  viteConfig: VitePlusConfig;
}> {
  const packageJson = (await readProjectJson(
    options.rootPath,
    options.packageJsonPath ?? 'package.json',
  )) as { scripts?: Record<string, unknown> };
  const ciWorkflowSource = await readProjectText(
    options.rootPath,
    options.ciWorkflowPath ?? '.github/workflows/ci.yml',
  );
  const viteConfig = await loadVitePlusConfig(
    await readProjectText(options.rootPath, options.viteConfigPath ?? 'vite.config.ts'),
  );

  return { ciWorkflowSource, packageJson, viteConfig };
}

export function p10PerfAcceptanceGateFact(options: {
  acceptance: P10PerfAcceptanceShape;
  ciWorkflowSource: string;
  packageJson: { scripts?: Record<string, unknown> };
  runFunction: unknown;
  scriptName?: string;
  viteConfig: VitePlusConfig;
}): P10PerfAcceptanceGateFact {
  const scriptName = options.scriptName ?? 'test:p10-perf';
  const gate = vitePlusAcceptanceTaskFacts({
    ciWorkflowSource: options.ciWorkflowSource,
    packageJson: options.packageJson,
    scriptName,
    viteConfig: options.viteConfig,
  });
  nodeTaskCommand(gate.task.command);
  assertOrderedItems(gate.acceptanceScripts, 'check:build', scriptName);
  assertOrderedItems(gate.acceptanceScripts, scriptName, 'check:fw');
  assertOrderedItems(gate.ciTaskNames, 'build', gate.taskName);
  assertOrderedItems(gate.ciTaskNames, gate.taskName, 'fw-check');

  return {
    acceptance: {
      browser: options.acceptance.browser,
      cdpMethods: options.acceptance.cdpMethods,
      heapNoiseBudget: options.acceptance.heapNoiseBudget,
      navigationCount: options.acceptance.navigationCount,
      paintEntry: options.acceptance.paintEntry,
      prerenderTimingField: options.acceptance.prerenderTimingField,
      ttiMetric: options.acceptance.ttiMetric,
    },
    inputFacts: vitePlusTaskInputFacts(gate.task),
    ordering: {
      acceptanceAfterBuild: true,
      acceptanceBeforeFwCheck: true,
      ciAfterBuild: true,
      ciBeforeFwCheck: true,
    },
    presentInAcceptance: gate.presentInAcceptance,
    presentInCi: gate.presentInCi,
    runFunction: typeof options.runFunction === 'function',
    scriptName: gate.scriptName,
    taskName: gate.taskName,
  };
}

export function p10PerfAcceptanceModulePath(options: {
  packageJson: { scripts?: Record<string, unknown> };
  scriptName?: string;
  viteConfig: VitePlusConfig;
}): string {
  const scriptName = options.scriptName ?? 'test:p10-perf';
  const taskName = requiredVpRunTaskName(scriptName, options.packageJson);
  const task = options.viteConfig.run?.tasks?.[taskName];
  assert.ok(task, `${taskName} task is defined`);
  return nodeTaskCommand(task.command).modulePath;
}

export async function p10PerfAcceptanceProjectFact(
  options: P10PerfAcceptanceProjectFactOptions,
): Promise<P10PerfAcceptanceGateFact> {
  const { ciWorkflowSource, packageJson, viteConfig } = await projectAcceptanceGateInputs(options);
  const modulePathOptions = {
    packageJson,
    viteConfig,
    ...(options.scriptName === undefined ? {} : { scriptName: options.scriptName }),
  };
  const modulePath = p10PerfAcceptanceModulePath(modulePathOptions);
  const imported = (await import(pathToFileURL(join(options.rootPath, modulePath)).href)) as {
    p10PerfAcceptance?: P10PerfAcceptanceShape;
    runP10PerfAcceptance?: unknown;
  };

  assert.ok(imported.p10PerfAcceptance, `${modulePath} exports p10PerfAcceptance`);

  return p10PerfAcceptanceGateFact({
    acceptance: imported.p10PerfAcceptance,
    ciWorkflowSource,
    packageJson,
    runFunction: imported.runP10PerfAcceptance,
    viteConfig,
    ...(options.scriptName === undefined ? {} : { scriptName: options.scriptName }),
  });
}

export function conformanceGateFacts(options: {
  expectedPackages: Record<string, string>;
  packageJson: { scripts?: Record<string, unknown> };
  packages: readonly PackageManifestFact[];
  scriptName: string;
  viteConfig: VitePlusConfig;
}): ConformanceGateFacts {
  const taskName = requiredVpRunTaskName(options.scriptName, options.packageJson);
  const task = options.viteConfig.run?.tasks?.[taskName];
  assert.ok(task, `${taskName} task is defined`);
  const commands = pnpmFilterTestCommands(task.command);
  const packageNames = options.packages.map(({ manifest }) => {
    if (typeof manifest.name !== 'string') {
      assert.fail('conformance package manifest has a name');
    }
    return manifest.name;
  });

  return {
    commands,
    everyCommandRunsTest: commands.every((entry) => entry.script === 'test'),
    everyPackageHasTestScript: options.packages.every(({ manifest }) =>
      Boolean(manifest.scripts?.test),
    ),
    expectedPackages: options.expectedPackages,
    inputFacts: vitePlusTaskInputFacts(task),
    packageEntries: options.packages.map(({ directory, manifest }) => [directory, manifest.name]),
    packageNames: packageNames.toSorted((left, right) => left.localeCompare(right)),
    presentInAcceptance: pnpmRunScriptNames(options.packageJson.scripts?.acceptance).includes(
      options.scriptName,
    ),
    taskName,
  };
}

export function vitePlusTaskInputFacts(task: VitePlusTask): VitePlusTaskInputFact[] {
  assert.equal(Array.isArray(task.input), true, 'Vite+ task input is an array');
  const inputEntries = task.input as unknown[];

  return inputEntries.map((entry: unknown, index: number) => {
    assert.equal(typeof entry, 'object', `Vite+ task input ${index} is an object`);
    assert.notEqual(entry, null, `Vite+ task input ${index} is an object`);
    const input = entry as Record<string, unknown>;
    const fact: VitePlusTaskInputFact = {};

    if (Object.hasOwn(input, 'auto')) {
      const auto = input.auto;
      if (typeof auto !== 'boolean') {
        assert.fail(`Vite+ task input ${index} auto is boolean`);
      }
      fact.auto = auto;
    }
    if (Object.hasOwn(input, 'base')) {
      const base = input.base;
      if (typeof base !== 'string') {
        assert.fail(`Vite+ task input ${index} base is string`);
      }
      fact.base = base;
    }
    if (Object.hasOwn(input, 'pattern')) {
      const pattern = input.pattern;
      if (typeof pattern !== 'string') {
        assert.fail(`Vite+ task input ${index} pattern is string`);
      }
      fact.pattern = pattern;
    }

    return fact;
  });
}

export function vitePlusTaskInputPatternEndingWith(task: VitePlusTask, suffix: string): string {
  const pattern = vitePlusTaskInputFacts(task).find((entry) =>
    entry.pattern?.endsWith(suffix),
  )?.pattern;
  assert.ok(pattern, `Vite+ task watches ${suffix}`);
  return pattern;
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

async function readProjectJson(rootPath: string, path: string): Promise<unknown> {
  return JSON.parse(await readProjectText(rootPath, path));
}

async function readProjectText(rootPath: string, path: string): Promise<string> {
  return readFile(join(rootPath, path), 'utf8');
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
