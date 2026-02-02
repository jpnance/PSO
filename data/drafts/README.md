# Draft Data Cache

This directory contains cached draft data fetched from Google Sheets.

## Files

- `drafts.json` - All draft picks from 2010 to present

## Refreshing the Cache

To refresh the draft cache from Google Sheets, run the pipeline without `--local`:

```bash
node data/inference/pipeline.js
```

The pipeline reads `GOOGLE_API_KEY` from `.env` and will automatically cache
the drafts for future local runs.
