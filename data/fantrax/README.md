# Fantrax Transaction Data

This directory stores transaction data exported from Fantrax for the 2020 and 2021 seasons.

## Expected Files

- `transactions-2020.json` - All transactions from the 2020 Fantrax season
- `transactions-2021.json` - All transactions from the 2021 Fantrax season

## How to Export from Fantrax

1. Log in to Fantrax and navigate to the league's transaction history
2. Export the data (format TBD based on available export options)
3. Save the file here with the appropriate name

## Data Format

The parser expects JSON data with transactions. The exact format will be determined
once we have sample data. The parser at `data/facts/fantrax-facts.js` includes
placeholder parsing logic that will be updated accordingly.

## Cross-referencing

The Fantrax data can be cross-referenced with:
- Cut data from Google Sheets (to validate salaries)
- Snapshot data from contracts-2020.txt and contracts-2021.txt
- Trade data from WordPress (for trades that were also posted there)
