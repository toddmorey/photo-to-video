const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const TRACKER_FILE = '.processed.json';

function getTrackerPath(outputDir) {
  return path.join(outputDir, TRACKER_FILE);
}

async function loadTracker(outputDir) {
  const trackerPath = getTrackerPath(outputDir);
  if (await fs.pathExists(trackerPath)) {
    return await fs.readJson(trackerPath);
  }
  return { version: 1, processed: {} };
}

async function saveTracker(outputDir, data) {
  await fs.ensureDir(outputDir);
  await fs.writeJson(getTrackerPath(outputDir), data, { spaces: 2 });
}

async function fileHash(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

async function isProcessed(outputDir, imagePath) {
  const tracker = await loadTracker(outputDir);
  const key = path.basename(imagePath);
  return !!tracker.processed[key];
}

async function markProcessed(outputDir, imagePath, { model, resolution, duration, outputs, prompt }) {
  const tracker = await loadTracker(outputDir);
  const key = path.basename(imagePath);
  tracker.processed[key] = {
    timestamp: new Date().toISOString(),
    hash: await fileHash(imagePath),
    model,
    resolution,
    duration,
    prompt: prompt.slice(0, 120),
    outputs,
  };
  await saveTracker(outputDir, tracker);
}

async function listProcessed(outputDir) {
  const tracker = await loadTracker(outputDir);
  return tracker.processed;
}

module.exports = { isProcessed, markProcessed, listProcessed, fileHash };
