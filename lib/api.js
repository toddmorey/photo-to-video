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
      'HTTP-Referer': 'https://github.com/toddmorey/photo-to-video',
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

// Normalise resolution to the string format the Videos API expects.
// Accepts "1920x1080", "1280x720", "1080p", "720p", "4k", etc.
function normalizeResolution(res) {
  if (!res) return '720p';
  const lower = res.toLowerCase().trim();
  if (/^\d+p$/.test(lower) || lower === '4k') return lower;
  const [, h] = lower.split('x').map(Number);
  if (!h) return lower;
  if (h >= 2160) return '4k';
  if (h >= 1080) return '1080p';
  if (h >= 720)  return '720p';
  return '480p';
}

// Fetch video generation models from the Videos API.
// Each model may include an allowed_passthrough_parameters field.
async function fetchVideoModels() {
  const response = await client().get('/videos/models');
  return response.data?.data ?? response.data ?? [];
}

// Return the allowed_passthrough_parameters for a specific model ID.
async function getModelParams(modelId) {
  const models = await fetchVideoModels();
  const model = models.find((m) => m.id === modelId);
  return model?.allowed_passthrough_parameters ?? [];
}

// Ask a vision model to recommend how many seconds the video should be.
// Returns an integer in [3, max]. Falls back to min(5, max) if unresponsive.
const DURATION_MODEL = 'google/gemini-2.5-flash';

async function suggestDuration(imagePath, prompt, { max = 10 } = {}) {
  const imageUri = await imageToDataUri(imagePath);
  const response = await client().post('/chat/completions', {
    model: DURATION_MODEL,
    max_tokens: 5,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUri } },
          {
            type: 'text',
            text: `This still image will be animated into a short video clip.\n\nAction to animate: "${prompt}"\n\nHow many seconds should this clip be to complete the described action naturally at a comfortable pace? Use only as many seconds as the action requires — don't pad. Simple gestures = shorter, multi-step sequences = longer.\n\nReply with a single integer between 3 and ${max}. No explanation.`,
          },
        ],
      },
    ],
  });
  const text = response.data.choices?.[0]?.message?.content?.trim() ?? '';
  const seconds = parseInt(text, 10);
  return Number.isFinite(seconds) ? Math.min(max, Math.max(3, seconds)) : Math.min(5, max);
}

// Submit an image-to-video job via the Videos API.
// The image is passed as the first frame via frame_images[].
async function submitGeneration({ imagePath, model, prompt, resolution, duration, frameType = 'first_frame' }) {
  const imageUri = await imageToDataUri(imagePath);

  const payload = {
    model,
    prompt,
    duration,
    resolution: normalizeResolution(resolution),
    aspect_ratio: '16:9',
    generate_audio: false,
    frame_images: [
      {
        type: 'image_url',
        image_url: { url: imageUri },
        frame_type: frameType,
      },
    ],
  };

  const response = await client().post('/videos', payload);
  return response.data;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);

// Poll GET /videos/{id} every 30 s until the job reaches a terminal status.
async function pollGeneration(jobId, { intervalMs = 30000, timeoutMs = 600000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const response = await client().get(`/videos/${jobId}`);
    const data = response.data;
    const status = data.status;
    if (status === 'completed') return data;
    if (TERMINAL_STATUSES.has(status)) {
      throw new Error(`Video generation ended with status: ${status}`);
    }
  }
  throw new Error(`Generation timed out after ${timeoutMs / 1000}s`);
}

// Download completed video from GET /videos/{id}/content (requires auth).
async function downloadVideo(jobId, destPath) {
  await fs.ensureDir(path.dirname(destPath));
  const key = process.env.OPENROUTER_API_KEY;
  const response = await axios.get(`${BASE_URL}/videos/${jobId}/content`, {
    headers: { Authorization: `Bearer ${key}` },
    responseType: 'arraybuffer',
  });
  await fs.writeFile(destPath, Buffer.from(response.data));
}

// Fetch account key info + credit balance from OpenRouter.
async function fetchKeyInfo() {
  const response = await client().get('/auth/key');
  return response.data;
}

// Fetch recent video generation history.
async function fetchGenerationHistory({ limit = 20 } = {}) {
  const response = await client().get('/videos', { params: { limit } });
  return response.data;
}

async function checkStats() {
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
      console.log(`\nLast ${generations.length} video generation(s)`);
      console.log('─'.repeat(40));
      console.log(`Total cost:  $${totalCost.toFixed(4)}`);
      generations.slice(0, 10).forEach((g) => {
        const ts = new Date(g.created_at).toLocaleDateString();
        const cost = g.total_cost ? `$${g.total_cost.toFixed(4)}` : '—';
        const model = (g.model || '?').split('/').pop();
        const dur = g.duration ? `${g.duration}s` : '—';
        console.log(`  ${ts}  ${model.padEnd(24)} ${dur.padEnd(6)} ${cost}`);
      });
    }

    console.log('');
  } catch (err) {
    console.error(chalk.red(`Stats error: ${err.response?.data?.error?.message || err.message}`));
    process.exit(1);
  }
}

module.exports = { submitGeneration, pollGeneration, downloadVideo, checkStats, fetchKeyInfo, fetchVideoModels, getModelParams, suggestDuration };
