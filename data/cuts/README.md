# Cuts Data Cache

This directory contains cached cuts data fetched from Google Sheets.

## Files

- `cuts.json` - All cuts from the master spreadsheet

## Refreshing the Cache

Run the pipeline without `--local`:

```bash
node data/inference/pipeline.js
```

The pipeline reads `GOOGLE_API_KEY` from `.env` and will automatically cache
the cuts for future local runs.
