const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const mime = require('mime-types');
const { submitGeneration, pollGeneration, downloadVideo, getModelParams } = require('./api');
const { isProcessed, markProcessed } = require('./tracker');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

async function loadPrompt(promptOverride) {
  if (promptOverride) return promptOverride.trim();
  const promptFile = path.resolve('prompts/default.txt');
  if (await fs.pathExists(promptFile)) {
    return (await fs.readFile(promptFile, 'utf8')).trim();
  }
  return 'Animate this image with subtle, natural motion.';
}

async function collectImages(inputDir) {
  const entries = await fs.readdir(inputDir);
  return entries
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(inputDir, f))
    .sort();
}

function outputName(imagePath, index, ext = '.mp4') {
  const base = path.basename(imagePath, path.extname(imagePath));
  return index > 1 ? `${base}_v${index}${ext}` : `${base}${ext}`;
}

async function processImages(options) {
  require('dotenv').config();

  const inputDir = path.resolve(options.input || './images');
  const outputDir = path.resolve(options.output || './output');
  const model = options.model || 'bytedance/seedance-1-5-pro';
  const resolution = options.resolution || '1280x720';
  const duration = parseInt(options.duration || '5', 10);
  const count = parseInt(options.multiple || '1', 10);
  const force = !!options.force;
  const dryRun = !!options.dryRun;

  const prompt = await loadPrompt(options.prompt);

  if (!(await fs.pathExists(inputDir))) {
    console.error(chalk.red(`Input directory not found: ${inputDir}`));
    process.exit(1);
  }

  const images = await collectImages(inputDir);
  if (!images.length) {
    console.log(chalk.yellow('No images found in ' + inputDir));
    return;
  }

  await fs.ensureDir(outputDir);

  // Fetch this model's allowed passthrough parameters so we only send what it supports.
  let allowedParams = [];
  if (!dryRun) {
    const spinner = ora('Fetching model parameters…').start();
    try {
      allowedParams = await getModelParams(model);
      if (allowedParams.length) {
        spinner.succeed(`Model params: ${allowedParams.join(', ')}`);
      } else {
        spinner.warn('No allowed_passthrough_parameters found — sending all fields');
      }
    } catch (err) {
      spinner.warn(`Could not fetch model params (${err.message}) — sending all fields`);
    }
  }

  console.log(chalk.bold(`\nphoto-to-video`));
  console.log(`Model:      ${model}`);
  console.log(`Resolution: ${resolution}`);
  console.log(`Duration:   ${duration}s`);
  console.log(`Variations: ${count}`);
  console.log(`Prompt:     ${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}`);
  console.log(`Images:     ${images.length} found`);
  if (dryRun) console.log(chalk.cyan('Dry run — no requests will be made'));
  console.log('');

  let skipped = 0;
  let processed = 0;
  let failed = 0;

  for (const imagePath of images) {
    const name = path.basename(imagePath);

    if (!force && (await isProcessed(outputDir, imagePath))) {
      console.log(chalk.dim(`  skip  ${name} (already converted; use --force to redo)`));
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(chalk.cyan(`  would process  ${name}`));
      continue;
    }

    const outputs = [];
    let imageOk = true;

    for (let i = 1; i <= count; i++) {
      const label = count > 1 ? `${name} [${i}/${count}]` : name;
      const spinner = ora(`  ${label}`).start();

      try {
        spinner.text = `  ${label} — submitting`;
        const submission = await submitGeneration({ imagePath, model, prompt, resolution, duration, allowedParams });
        const genId = submission.id || submission.data?.id;

        if (!genId) throw new Error('No generation ID returned from API');

        spinner.text = `  ${label} — waiting for generation…`;
        const result = await pollGeneration(genId);

        const videoUrl =
          result.data?.url ||
          result.url ||
          (Array.isArray(result.data) && result.data[0]?.url);

        if (!videoUrl) throw new Error('No video URL in completed generation');

        const outFile = path.join(outputDir, outputName(imagePath, i));
        spinner.text = `  ${label} — downloading`;
        await downloadVideo(videoUrl, outFile);

        outputs.push(path.basename(outFile));
        spinner.succeed(chalk.green(`  ${label} → ${path.basename(outFile)}`));
      } catch (err) {
        spinner.fail(chalk.red(`  ${label} — ${err.message}`));
        imageOk = false;
        failed++;
      }
    }

    if (imageOk && outputs.length) {
      await markProcessed(outputDir, imagePath, { model, resolution, duration, outputs, prompt });
      processed++;
    }
  }

  console.log('');
  console.log(chalk.bold('Done.'));
  if (processed) console.log(chalk.green(`  ${processed} image(s) converted`));
  if (skipped) console.log(chalk.dim(`  ${skipped} skipped (already processed)`));
  if (failed) console.log(chalk.red(`  ${failed} failed`));
  console.log('');
}

module.exports = { processImages, loadPrompt };
