# Sleeper Transaction Data

Place Sleeper transaction exports here with the naming convention:

```
transactions-2021.json
transactions-2022.json
transactions-2023.json
...
```

The service expects either:
- Raw array of transaction objects
- Object with `data.league_transactions_filtered` array (Sleeper API format)

Access the import tool at `/admin/sleeper-import` to parse and review the data.
