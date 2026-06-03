# photo-to-video

Convert images to video using OpenRouter AI models. Tracks which images have already been processed so reruns are safe by default.

## Setup

```bash
npm install
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env
```

Drop source images into `./images`, then run:

```bash
node index.js generate
```

## Directory structure

```
photo-to-video/
├── index.js              ← CLI entry point
├── lib/
│   ├── api.js            ← OpenRouter client (generate, poll, stats)
│   ├── processor.js      ← orchestrates image→video flow
│   └── tracker.js        ← .processed.json skip logic
├── prompts/
│   └── default.txt       ← editable default prompt
├── images/               ← drop source images here
├── output/               ← videos land here
└── .env.example
```

## Commands

| Command | What it does |
|---|---|
| `node index.js generate` | Process `./images`, skip already-done ones |
| `node index.js generate --force` | Reprocess everything |
| `node index.js generate --dry-run` | Preview without making API calls |
| `node index.js generate -n 3` | 3 video variations per image |
| `node index.js generate -m luma/photon -d 8 -r 1920x1080` | Custom model, duration, resolution |
| `node index.js generate -p "Custom motion prompt"` | One-shot prompt override |
| `node index.js models` | List available video models and their supported parameters |
| `node index.js models -m bytedance/seedance-1-5-pro` | Show a specific model's allowed parameters |
| `node index.js prompt --set "..."` | Update the saved default prompt |
| `node index.js prompt --edit` | Open prompt in `$EDITOR` |
| `node index.js stats` | Credits used + recent generation history |
| `node index.js history` | List already-processed images |

Run `node index.js generate --help` for the full flag reference.

## Prompts

The default prompt lives in `prompts/default.txt` and is used for any image that doesn't have its own prompt. Edit it directly or use:

```bash
node index.js prompt --set "Pan slowly across the scene with cinematic motion."
node index.js prompt --edit
```

### Per-image prompts

Place a prompt file next to the image with the same base name:

```
images/
  sunset.jpg
  sunset.txt        ← plain text prompt for sunset.jpg
  portrait.jpg
  portrait.json     ← JSON prompt for portrait.jpg
```

`.txt` — plain text, used as-is.

`.json` — must include a `prompt` key:

```json
{ "prompt": "Slowly zoom in on the subject with warm golden light." }
```

If both exist, `.txt` takes precedence. If neither exists, the default prompt is used. The CLI marks images using a custom prompt with `[custom prompt]` in the output.

## Skip logic

Once an image is converted, its record is written to `output/.processed.json`. On the next run, that image is skipped automatically. Use `--force` to reprocess, or `--dry-run` to see what would be skipped.

## Model parameters

Before each run, the CLI queries OpenRouter's Video Models API (`GET /api/v1/models?type=video`) and reads the `allowed_passthrough_parameters` field for the selected model. Only supported parameters are included in the generation request — unsupported fields are silently dropped, avoiding provider errors.

To inspect what a model supports before running:

```bash
node index.js models
node index.js models -m bytedance/seedance-1-5-pro
```

The default model is `bytedance/seedance-1-5-pro` (Seedance 2). If the exact model ID differs on your OpenRouter account, use `node index.js models` to find the correct one and pass it with `-m`.
