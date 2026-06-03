#!/usr/bin/env node
require('dotenv').config();
const { program } = require('commander');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

const { processImages, loadPrompt } = require('./lib/processor');
const { checkStats, fetchKeyInfo, fetchVideoModels } = require('./lib/api');
const { listProcessed } = require('./lib/tracker');

program
  .name('photo-to-video')
  .description('Convert images to video using OpenRouter AI models')
  .version('1.0.0');

// ── generate ──────────────────────────────────────────────────────────────────
program
  .command('generate', { isDefault: true })
  .description('Generate videos from images in a directory')
  .option('-i, --input <dir>', 'Directory of source images', './images')
  .option('-o, --output <dir>', 'Directory for output videos', './output')
  .option('-m, --model <model>', 'OpenRouter model ID', 'bytedance/seedance-1-5-pro')
  .option('-r, --resolution <WxH>', 'Video resolution', '1280x720')
  .option('-d, --duration <seconds>', 'Video duration in seconds', '5')
  .option('-p, --prompt <text>', 'Override the prompt (otherwise uses prompts/default.txt)')
  .option('-n, --multiple <count>', 'Number of video variations per image', '1')
  .option('-f, --force', 'Reprocess images that have already been converted')
  .option('--dry-run', 'Show what would be processed without making API calls')
  .addHelpText('after', `
Examples:
  photo-to-video generate
  photo-to-video generate -i ./photos -o ./videos -m luma/photon -d 8
  photo-to-video generate --multiple 3 --force
  photo-to-video generate --dry-run
  photo-to-video generate -m "kling/kling-v1-5" -r 1920x1080 -d 10
`)
  .action(async (options) => {
    await processImages(options);
  });

// ── models ────────────────────────────────────────────────────────────────────
program
  .command('models')
  .description('List available video models and their supported parameters')
  .option('-m, --model <id>', 'Show details for a specific model ID')
  .action(async (options) => {
    const ora = require('ora');
    const spinner = ora('Fetching video models…').start();
    try {
      const models = await fetchVideoModels();
      spinner.stop();

      if (!models.length) {
        console.log(chalk.yellow('No video models found.'));
        return;
      }

      if (options.model) {
        const m = models.find((x) => x.id === options.model);
        if (!m) {
          console.log(chalk.red(`Model not found: ${options.model}`));
          console.log(chalk.dim('Run `models` without a flag to list all available models.'));
          return;
        }
        console.log(chalk.bold(`\n${m.name || m.id}`));
        console.log(`ID:          ${m.id}`);
        if (m.description) console.log(`Description: ${m.description}`);
        if (m.pricing?.completion) console.log(`Pricing:     $${m.pricing.completion} / token`);
        const params = m.allowed_passthrough_parameters ?? [];
        console.log(`\nallowed_passthrough_parameters:`);
        if (params.length) {
          params.forEach((p) => console.log(`  ${chalk.cyan(p)}`));
        } else {
          console.log(chalk.dim('  (none listed)'));
        }
        console.log('');
        return;
      }

      console.log(chalk.bold(`\n${models.length} video model(s)\n`));
      models.forEach((m) => {
        const params = (m.allowed_passthrough_parameters ?? []).join(', ') || chalk.dim('—');
        console.log(`  ${chalk.bold(m.id)}`);
        console.log(`    params: ${params}`);
      });
      console.log('');
    } catch (err) {
      spinner.fail(chalk.red(`Error: ${err.response?.data?.error?.message || err.message}`));
      process.exit(1);
    }
  });

// ── stats ─────────────────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Show OpenRouter usage stats and credit balance')
  .action(async () => {
    await checkStats();
  });

// ── prompt ────────────────────────────────────────────────────────────────────
program
  .command('prompt')
  .description('Show or update the default prompt')
  .option('-s, --set <text>', 'Replace the prompt with this text')
  .option('-e, --edit', 'Open prompts/default.txt in $EDITOR')
  .addHelpText('after', `
Examples:
  photo-to-video prompt
  photo-to-video prompt --set "Pan slowly across the scene with cinematic motion."
  photo-to-video prompt --edit
`)
  .action(async (options) => {
    const promptFile = path.resolve('prompts/default.txt');
    await fs.ensureDir(path.dirname(promptFile));

    if (options.set) {
      await fs.writeFile(promptFile, options.set.trim() + '\n', 'utf8');
      console.log(chalk.green('Prompt updated.'));
      return;
    }

    if (options.edit) {
      const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
      const { execSync } = require('child_process');
      await fs.ensureFile(promptFile);
      execSync(`${editor} "${promptFile}"`, { stdio: 'inherit' });
      return;
    }

    const current = await loadPrompt();
    console.log(chalk.bold('\nCurrent prompt:'));
    console.log(current);
    console.log(chalk.dim(`\n(stored in ${path.relative(process.cwd(), promptFile)})`));
    console.log('');
  });

// ── history ───────────────────────────────────────────────────────────────────
program
  .command('history')
  .description('List images already converted (from the tracking file)')
  .option('-o, --output <dir>', 'Output directory to read tracking file from', './output')
  .action(async (options) => {
    const outputDir = path.resolve(options.output);
    const records = await listProcessed(outputDir);
    const keys = Object.keys(records);

    if (!keys.length) {
      console.log(chalk.dim('No images have been processed yet.'));
      return;
    }

    console.log(chalk.bold(`\n${keys.length} processed image(s)\n`));
    keys.forEach((name) => {
      const r = records[name];
      const ts = new Date(r.timestamp).toLocaleDateString();
      const model = r.model.split('/').pop();
      const outs = r.outputs.join(', ');
      console.log(`  ${name.padEnd(36)} ${ts}  ${model.padEnd(24)} → ${outs}`);
    });
    console.log('');
  });

program.parse(process.argv);
