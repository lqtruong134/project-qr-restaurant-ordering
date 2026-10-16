import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assistantDataSplits,
  evaluateAssistantPredictions,
  validateAssistantDatasets,
  type AssistantDataSplit,
} from '../packages/contracts/src/menu-assistant-evaluation.js';

const usage = [
  'node --import tsx scripts/menu-assistant-data.ts validate',
  'node --import tsx scripts/menu-assistant-data.ts evaluate --predictions <jsonl> --output <json> [--split evaluation|validation]',
].join('\n');

async function jsonl(path: string): Promise<unknown[]> {
  const source = await readFile(path, 'utf8');
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { invalidJsonLine: index + 1 };
      }
    });
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === 'help') {
    console.log(usage);
    return;
  }
  if (!['validate', 'evaluate'].includes(command ?? '')) throw new Error(usage);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (
      !key ||
      !['--predictions', '--output', '--split'].includes(key) ||
      !value ||
      value.startsWith('--') ||
      options.has(key)
    )
      throw new Error('Invalid or repeated command option.\n' + usage);
    options.set(key, value);
  }
  if (command === 'validate' && options.size) throw new Error('validate does not accept options.');
  const split = options.get('--split') ?? 'evaluation';
  if (split !== 'evaluation' && split !== 'validation')
    throw new Error('--split must be evaluation or validation; train cannot be evaluated.');
  if (command === 'evaluate' && (!options.get('--predictions') || !options.get('--output')))
    throw new Error('evaluate requires --predictions and --output.\n' + usage);

  if (command === 'evaluate') {
    const output = resolve(options.get('--output')!);
    const protectedPaths = [
      resolve(options.get('--predictions')!),
      ...assistantDataSplits.map((name) => resolve('ai/menu-assistant/data', name + '.jsonl')),
    ];
    const identity = async (path: string) => realpath(path).catch(() => path);
    const identities = await Promise.all([output, ...protectedPaths].map(identity));
    if (protectedPaths.includes(output) || identities.slice(1).includes(identities[0]!))
      throw new Error('Report output must not overwrite dataset files or the predictions input.');
  }

  // Only local JSONL is read. This program never loads .env, queries a DB, or calls a provider.
  const loaded = await Promise.all(
    assistantDataSplits.map(
      async (name) =>
        [name, await jsonl(resolve('ai/menu-assistant/data', name + '.jsonl'))] as const,
    ),
  );
  const validation = validateAssistantDatasets(
    Object.fromEntries(loaded) as Record<AssistantDataSplit, unknown[]>,
  );
  if (!validation.valid || command === 'validate') {
    console.log(
      JSON.stringify(
        {
          validationType: 'SCHEMA_SPLIT_TOOL_TRAJECTORY_AND_GOLD_FACT_CHECKS_ONLY',
          modelQualityMeasured: false,
          valid: validation.valid,
          counts: validation.counts,
          issues: validation.issues,
        },
        null,
        2,
      ),
    );
    if (!validation.valid) process.exitCode = 1;
    return;
  }
  const predictions = await jsonl(resolve(options.get('--predictions')!));
  const report = {
    split,
    ...evaluateAssistantPredictions(validation.examples[split], predictions),
  };
  const output = resolve(options.get('--output')!);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.overallPass) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Offline assistant data command failed.');
  process.exitCode = 1;
});
