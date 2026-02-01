# Fantrax Transaction Data

This directory stores transaction data from Fantrax for the 2020 and 2021 seasons.

## Files

- `transactions-2020.json` - All transactions from the 2020 Fantrax season (554 transactions, 739 rows)
- `transactions-2021.json` - All transactions from the 2021 Fantrax season (739 transactions, 910 rows)

## How to Export from Fantrax

The data comes from Fantrax's internal XHR API, not the CSV export (which lacks transaction grouping).

1. Log in to Fantrax and navigate to the league's transaction history
2. Open browser DevTools → Network tab
3. Filter for XHR requests
4. Paginate through results (or hack the `maxResultsPerPage` parameter)
5. Copy the JSON response and save here

The response structure is:
```
responses[0].data.table.rows[]  - array of player movements
```

Each row has a `txSetId` field that groups related movements (e.g., a claim + corresponding drop form one transaction).

## Data Format

The parser at `data/facts/fantrax-facts.js` expects this XHR JSON format and:
- Groups rows by `txSetId` into unified transactions
- Extracts player info from `scorer` object
- Extracts owner/date/week/bid from `cells` array
- Produces output similar to the Sleeper parser (with `adds` and `drops` arrays)

## Cross-referencing

The Fantrax data can be cross-referenced with:
- Cut data from Google Sheets (to validate salaries)
- Snapshot data from contracts-2020.txt and contracts-2021.txt
- Trade data from WordPress (for trades that were also posted there)
