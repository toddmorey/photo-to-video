require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

const BASE_URL = 'https://openrouter.ai/api/v1';

function client() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error(chalk.red('Error: OPENROUTER_API_KEY not set. Copy .env.example to .env and add your key.'));
    process.exit(1);
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/photo-to-video',
      'X-Title': 'photo-to-video',
    },
  });
}

// Encodes a local image file as a base64 data URI
async function imageToDataUri(imagePath) {
  const mime = require('mime-types');
  const mimeType = mime.lookup(imagePath) || 'image/jpeg';
  const data = await fs.readFile(imagePath);
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

// Submit an image-to-video generation request.
// OpenRouter routes to providers like Runway, Luma, Kling, etc.
// The generations endpoint returns a generation ID for async polling.
async function submitGeneration({ imagePath, model, prompt, resolution, duration }) {
  const [width, height] = resolution.split('x').map(Number);
  const imageUri = await imageToDataUri(imagePath);

  const payload = {
    model,
    prompt,
    image: imageUri,
    width: width || 1280,
    height: height || 720,
    duration,
  };

  const response = await client().post('/generation', payload);
  return response.data;
}

// Poll for a generation result until complete or failed.
async function pollGeneration(generationId, { intervalMs = 5000, timeoutMs = 300000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await client().get(`/generation?id=${generationId}`);
    const data = response.data;

    if (data.status === 'complete' || data.data?.status === 'complete') {
      return data;
    }
    if (data.status === 'failed' || data.data?.status === 'failed') {
      throw new Error(`Generation failed: ${data.error || data.data?.error || 'unknown error'}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Generation timed out after ${timeoutMs / 1000}s`);
}

// Download a video URL to a local file path.
async function downloadVideo(videoUrl, destPath) {
  await fs.ensureDir(path.dirname(destPath));
  const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
  await fs.writeFile(destPath, Buffer.from(response.data));
}

// Fetch account key info + credit balance from OpenRouter.
async function fetchKeyInfo() {
  const response = await client().get('/auth/key');
  return response.data;
}

// Fetch recent generation activity (costs, model usage).
async function fetchGenerationHistory({ limit = 20 } = {}) {
  const response = await client().get(`/generation?limit=${limit}`);
  return response.data;
}

async function checkStats() {
  const chalk = require('chalk');
  try {
    const keyInfo = await fetchKeyInfo();
    const history = await fetchGenerationHistory({ limit: 50 });

    console.log(chalk.bold('\nOpenRouter Account'));
    console.log('─'.repeat(40));

    const data = keyInfo.data || keyInfo;
    if (data.label) console.log(`Key:       ${data.label}`);
    if (data.limit != null) {
      const used = data.usage ?? 0;
      const limit = data.limit;
      const pct = limit > 0 ? ((used / limit) * 100).toFixed(1) : '—';
      console.log(`Credits:   $${used.toFixed(4)} used of $${limit.toFixed(2)} (${pct}%)`);
    } else if (data.usage != null) {
      console.log(`Credits used: $${Number(data.usage).toFixed(4)}`);
    }

    const generations = history.data ?? [];
    if (generations.length) {
      const totalCost = generations.reduce((sum, g) => sum + (g.total_cost || 0), 0);
      const videoGens = generations.filter((g) => g.model_slug?.includes('video') || g.latency > 5000);

      console.log(`\nLast ${generations.length} generations`);
      console.log('─'.repeat(40));
      console.log(`Total cost:  $${totalCost.toFixed(4)}`);

      generations.slice(0, 10).forEach((g) => {
        const ts = new Date(g.created_at).toLocaleDateString();
        const cost = g.total_cost ? `$${g.total_cost.toFixed(4)}` : '—';
        const model = (g.model || g.model_slug || '?').split('/').pop();
        console.log(`  ${ts}  ${model.padEnd(28)} ${cost}`);
      });
    }

    console.log('');
  } catch (err) {
    console.error(chalk.red(`Stats error: ${err.response?.data?.error?.message || err.message}`));
    process.exit(1);
  }
}

module.exports = { submitGeneration, pollGeneration, downloadVideo, checkStats, fetchKeyInfo };
