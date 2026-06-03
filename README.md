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
| `node index.js prompt --set "..."` | Update the saved default prompt |
| `node index.js prompt --edit` | Open prompt in `$EDITOR` |
| `node index.js stats` | Credits used + recent generation history |
| `node index.js history` | List already-processed images |

Run `node index.js generate --help` for the full flag reference.

## Prompt

The default prompt lives in `prompts/default.txt` and is used for every generation unless you pass `-p`. Edit it directly or use:

```bash
node index.js prompt --set "Pan slowly across the scene with cinematic motion."
node index.js prompt --edit
```

## Skip logic

Once an image is converted, its record is written to `output/.processed.json`. On the next run, that image is skipped automatically. Use `--force` to reprocess, or `--dry-run` to see what would be skipped.

## Note on video API compatibility

OpenRouter's video generation API (`POST /api/v1/generation`) routes to providers like Runway, Luma, and Kling. The exact field names each model expects may vary. If a specific model returns an error, `lib/api.js:submitGeneration` is the place to adjust the request payload.
