const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const ora = require('ora');
const mime = require('mime-types');
const { submitGeneration, pollGeneration, downloadVideo, suggestDuration } = require('./api');
const { isProcessed, markProcessed } = require('./tracker');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

async function loadDefaultPrompt(promptOverride) {
  if (promptOverride) return promptOverride.trim();
  const promptFile = path.resolve('prompts/default.txt');
  if (await fs.pathExists(promptFile)) {
    return (await fs.readFile(promptFile, 'utf8')).trim();
  }
  return 'Animate this image with subtle, natural motion.';
}

// Look for a per-image prompt alongside the image file.
// Checks <basename>.txt then <basename>.json ({ "prompt": "...", "duration": 7 | "auto" }).
// Returns { prompt, source, duration } where:
//   source   — 'image' | 'default'
//   duration — number | 'auto' | undefined (undefined means use the CLI default)
async function loadImagePrompt(imagePath, defaultPrompt) {
  const base = path.join(path.dirname(imagePath), path.basename(imagePath, path.extname(imagePath)));

  const txtPath = base + '.txt';
  if (await fs.pathExists(txtPath)) {
    const text = (await fs.readFile(txtPath, 'utf8')).trim();
    if (text) return { prompt: text, source: 'image', duration: undefined };
  }

  const jsonPath = base + '.json';
  if (await fs.pathExists(jsonPath)) {
    const data = await fs.readJson(jsonPath);
    const text = (data.prompt || '').trim();
    if (text) {
      const duration = data.duration === 'auto' ? 'auto'
        : typeof data.duration === 'number' ? data.duration
        : undefined;
      return { prompt: text, source: 'image', duration };
    }
  }

  return { prompt: defaultPrompt, source: 'default', duration: undefined };
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

// Derive frame_type from the image filename suffix.
// _end → last_frame; everything else (including _start or no suffix) → first_frame.
function getFrameType(imagePath) {
  const base = path.basename(imagePath, path.extname(imagePath));
  return base.endsWith('_end') ? 'last_frame' : 'first_frame';
}

async function processImages(options) {
  require('dotenv').config();

  const inputDir = path.resolve(options.input || './images');
  const outputDir = path.resolve(options.output || './output');
  const model = options.model || 'bytedance/seedance-2.0';
  const resolution = options.resolution || '1280x720';
  const durationInput = options.duration || '5';
  const cliDuration = durationInput === 'auto' ? 'auto' : parseInt(durationInput, 10);
  const maxDuration = options.maxDuration ? parseInt(options.maxDuration, 10) : 10;
  const count = parseInt(options.multiple || '1', 10);
  const force = !!options.force;
  const dryRun = !!options.dryRun;

  const defaultPrompt = await loadDefaultPrompt(options.prompt);

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


  console.log(chalk.bold(`\nphoto-to-video`));
  console.log(`Model:      ${model}`);
  console.log(`Resolution: ${resolution}`);
  console.log(`Duration:   ${cliDuration === 'auto' ? 'auto (model decides per image)' : `${cliDuration}s`}`);
  console.log(`Variations: ${count}`);
  console.log(`Prompt:     ${defaultPrompt.slice(0, 80)}${defaultPrompt.length > 80 ? '…' : ''} ${chalk.dim('(default)')}`);
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

    const { prompt, source: promptSource, duration: imageDuration } = await loadImagePrompt(imagePath, defaultPrompt);
    const promptTag = promptSource === 'image' ? chalk.cyan(' [custom prompt]') : '';
    const frameType = getFrameType(imagePath);
    const frameTag = frameType === 'last_frame' ? chalk.magenta(' [end frame]') : '';

    // Resolve final duration for this image: JSON sidecar > CLI flag
    const rawDuration = imageDuration ?? cliDuration;
    let effectiveDuration;
    let durationTag = '';

    if (rawDuration === 'auto') {
      if (dryRun) {
        durationTag = chalk.yellow(' [auto duration]');
      } else {
        const dSpinner = ora(`  ${name} — asking model for duration…`).start();
        try {
          effectiveDuration = await suggestDuration(imagePath, prompt, { max: maxDuration });
          dSpinner.succeed(`  ${name} — ${effectiveDuration}s suggested`);
          durationTag = chalk.yellow(` [${effectiveDuration}s]`);
        } catch (err) {
          dSpinner.warn(`  ${name} — duration suggestion failed (${err.message}), using 5s`);
          effectiveDuration = 5;
          durationTag = chalk.dim(` [5s fallback]`);
        }
      }
    } else {
      effectiveDuration = rawDuration;
    }

    if (dryRun) {
      console.log(chalk.cyan(`  would process  ${name}${promptTag}${frameTag}${durationTag}`));
      continue;
    }

    const outputs = [];
    let imageOk = true;

    for (let i = 1; i <= count; i++) {
      const label = count > 1 ? `${name} [${i}/${count}]` : name;
      const tags = `${promptTag}${frameTag}${durationTag}`;
      const spinner = ora(`  ${label}${tags}`).start();

      try {
        spinner.text = `  ${label}${tags} — submitting`;
        const submission = await submitGeneration({ imagePath, model, prompt, resolution, duration: effectiveDuration, frameType });
        const genId = submission.id || submission.data?.id;

        if (!genId) throw new Error('No generation ID returned from API');

        spinner.text = `  ${label}${tags} — waiting for generation…`;
        await pollGeneration(genId);

        const outFile = path.join(outputDir, outputName(imagePath, i));
        spinner.text = `  ${label}${tags} — downloading`;
        await downloadVideo(genId, outFile);

        outputs.push(path.basename(outFile));
        spinner.succeed(chalk.green(`  ${label}${tags} → ${path.basename(outFile)}`));
      } catch (err) {
        spinner.fail(chalk.red(`  ${label} — ${err.message}`));
        imageOk = false;
        failed++;
      }
    }

    if (imageOk && outputs.length) {
      await markProcessed(outputDir, imagePath, { model, resolution, duration: effectiveDuration, outputs, prompt });
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

module.exports = { processImages, loadPrompt: loadDefaultPrompt };
