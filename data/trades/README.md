# Trades Data Cache

This directory contains cached trade data fetched from WordPress.

## Files

- `trades.json` - All trades from the WordPress API

## Refreshing the Cache

Run the pipeline without `--local`:

```bash
node data/inference/pipeline.js
```

The pipeline will automatically cache trades for future local runs.
No API key is required for WordPress.
