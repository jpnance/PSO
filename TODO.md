# PSO Backlog

## High Priority
*Before Feb 7 trade window opening*

- [x] **Polish the trading experience** - critical path for owner adoption
  - [x] Fix budget impact card flash of unstyled content on Trade Machine
  - [x] Trade Machine: Don't show "Propose Trade" button during dead period
  - [x] Trade Machine: Remove notes field (admin-only)
  - [x] Proposal page: Drafts included in 7-day cleanup (Delete button removed)
  - [x] Proposal page: Updated copy to "This hypothetical trade hasn't been officially proposed."
  - [x] Proposal page: Removed Cash Neutral badge (redundant with table)
  - [x] Cash assets in trades should use formatMoney
  - [x] Replace "(RFA rights)" with "RFA rights" in trade display
  - [x] Show cap violation warnings in Budget Impact widget
- [x] Allow owners to drop players
- [x] Manual testing with open trade window

## Medium Priority
*Before August (rookie draft / cut day / auction / season start)*

### Owner-Facing Features
- [ ] RFA screen - show all restricted free agents ⚡ *quick win*
- [ ] UFA screen - show all unrestricted free agents ⚡ *quick win*
- [ ] Cuts screen - ask owners for their cuts ahead of cut day
- [ ] Contract setting screen - ask owners to set contracts ahead of contract day
- [ ] Rookie draft client - allow owners to make their own picks
- [ ] FAAB implementation (free agent auction bidding)

### Integrations
- [ ] Hook up adds/drops/trades to Sleeper *(reduces your manual work)*
- [ ] Get the auction app integrated with Coinflipper Login service

### Information Pages
- [x] Full standings page ⚡ *quick win*
- [ ] Schedule/results page (maybe special case of `/history`?) ⚡ *quick win*

### Migrations (existing features → new setup)
- [ ] Integrate `/history` into the new setup *(navbar is easy; polish is not)*
- [ ] Integrate `/h2h` into the new setup *(navbar is easy; polish is not)*
- [x] Integrate `/jaguar` into the new setup
- [ ] Integrate `/simulator` into the new setup *(already responsive, may be close)*
- [x] Route consistency: `/franchise/:rosterId` → `/franchises/:id` with landing page

### Trading & Transactions
- [ ] Extract `buildValidationParties(deal)` helper — same "deal → parties with contract lookups" logic exists in 3 places
- [x] Should budget impact on a hypothetical/proposed trade be baked into the trade details?
- [x] Update proposal page to use inline budget impact style (match trade machine)
- [x] Re-add cash-neutral button somewhere — now in action footer with "Make Cash-Neutral for [year]"
- [ ] Maybe "vetoed" should be a status when the commissioner rejects a trade?
- [ ] **Trade-required drops** — flow for prompting an owner to drop players to complete a trade (roster space)
- [ ] **Proposal drops** — allow trade creator to specify their drop upfront as part of the proposal (separate FA transaction with `facilitatedTradeId` when executed)
- [ ] Improve commissioner trade approval screen (currently bare-bones)
- [ ] Figure out how to deal with locked players in trades
- [x] Figure out a data backfill strategy to get more past transactions into the system
- [ ] **Auto-execute trades toggle** — `LeagueConfig.autoExecuteTrades` flag to skip commissioner approval
- [ ] **Transaction rollbacks** — ability to undo executed trades (see details below)

#### Transaction Rollback Implementation

**Schema changes:**
- [ ] Add `originalFranchiseId` to `tradePlayerSchema` in `models/Transaction.js`
- [ ] Add `originalFranchiseId` to `tradePickSchema` (for traded picks)

**Backfill:**
- [ ] 2-party trades: Infer `originalFranchiseId` programmatically (the other party gave it)
- [ ] 3-party trades (3 total): Manually supply original owner data

**Code changes:**
- [ ] Update `processTrade` in `services/transaction.js` to persist `originalOwners` (already computed at line 607-629, just not saved)
- [ ] Create `rollbackTrade` function:
  - Restore each asset to its `originalFranchiseId`
  - Negate budget deltas (payroll, recoverable, cashIn, cashOut, available)
  - Mark Transaction as reversed/voided
  - Update TradeProposal status if applicable
- [ ] Add admin UI trigger for rollback

**Edge cases:**
- Player cut after being traded (now has buyouts)
- Traded pick already used in draft
- Downstream budget changes based on trade

**Out of scope (for now):**
- FA rollback (complexity of restoring roster state)
- Auction rollback (RFA state complexity)

## Lower Priority
*Nice to have, no hard deadline*

### Historical Data Reconstruction
- [x] Parse `data/archive/` files to reconstruct early league history (2008-2019)
  - Contract snapshots seeded via `fa-snapshot.js`
  - Cuts ledger seeded via `cuts.js` with refined timestamps
  - FA reacquisitions inferred via `fa-reacquisition.js`
  - Auction wins inferred via `auction.js` and `auction-cuts.js` (including 2008 founding auction)
  - RFA conversions seeded via `rfa-conversions.js`
  - 2012 expansion draft seeded via `expansion-draft-2012.js` (protections + selections)
  - Trade history parsed from WordPress via `trade-facts.js`

### Information & Content
- [ ] Bring the rules document over to the website
- [ ] General transaction log
- [ ] Season overview page
- [x] Player cards - click into to see player details and transaction history
- [ ] Tool for owners to query past results
- [ ] League Hall of Fame

### UI/UX Polish
- [ ] Make the site more uniform looking
- [ ] Improve icons in the navbar for small breakpoints
- [ ] Admin players page - more mobile-friendly (smaller text, college truncation)
- [x] Admin players page - make college editable for historical players
- [ ] Search results - show NFL team or college when displaying multiple players with same name
- [ ] Admin proposals page - extract inline styles to CSS
- [x] Improve layout of info banners across the site — created `+alertBanner(type, icon, text)` mixin with template for JS
- [ ] Improve acceptance window countdown banner style (currently centered, doesn't use alertBanner mixin)
- [ ] Integrate acceptance countdown banner into acceptance status card?
- [ ] Show info banner first on trade proposal screen at mobile breakpoint

### Infrastructure & Technical
- [ ] Figure out a better way to structure database reports
- [x] Clean up directory structure
- [ ] Refactor formatContractDisplay to handle RFA rights and unsigned cases (remove || 0 coercion and manual checks)
- [ ] Add generic error pages (404, 500, etc.)
- [ ] Remove `?test-share=1` dev-only query param from proposal view
- [ ] Consider E2E testing with Playwright
- [x] Add sandbox message banner to league config seed
- [ ] Investigate upgrading Bootstrap 4 → 5 (gap utilities, updated components, breaking changes?)

## Ideas / Someday
*Experiments, long-term vision, not committed*

### UI/UX Experiments
- [ ] Experiment with color schemes (themed to Summer Meetings location each year?)
- [x] Breadcrumbs in Coinflipper app style
- [x] Tighten up draft picks widget on franchise page (3 columns? conflicts with showing results)
- [x] Revisit naming for `/propose` and `/trades` - resolved: `/trade-machine`, `/proposals/:slug`, `/trades`, `/trades/:id`
- [ ] Trade display: two columns at larger breakpoints? (let multi-party asset lists flow naturally)

### Standings Enhancements
- [x] Introduce Season model to store computed season-level data (playoff seeds, results, etc.)
- [ ] Add win/loss streaks to standings page
- [x] Unify homepage standings widget with full standings page patterns

### Misc Ideas
- [ ] **Retroactive trade-facilitation linking UI** — Open a historical drop and link it to a trade after the fact (e.g., found in email that this cut was for Trade #X)
- [ ] Rename "admin" to "commissioner" or "commish" throughout (for fun)
- [ ] Consider having roles specific to PSO ("commish", "podcast host")
- [ ] Bring PSO Show podcast notes to the website (`tools/note/` → web feature)
- [ ] Consider a better schedule generation experience
- [ ] Fantasy prep tools as web interface (`prep/` → could feed into auction/draft clients)
- [ ] Projections page — show preseason game predictions (`tools/projections.js` → web page)
- [ ] Get a real league logo
- [ ] Implement a simple blog feature
- [ ] Figure out how to support Colbys basketball league

### Dragons (complex rewrites, no timeline)
- [ ] Tame the simulator (`simulator/` — part CLI, part HTML generator, part JSON generator)
- [ ] Auction app overhaul (`auction/` — needs Login integration, general cleanup)

### Needs Discussion
- [ ] Trade TTL edge cases: What happens when someone withdraws acceptance but trade is past TTL? Should any action on a trade renew its TTL? Think through pending trade lifecycle more carefully.

### Data Quality Overrides
- [ ] Mechanism to override Sleeper data when it's known to be wrong
  - **Example:** Chris Johnson (sleeperId 272) is the famous Titans/Jets RB, but Sleeper has him tagged as `DB/RB`
  - **Example:** Charles Johnson (sleeperId 37) has `DL/WR` which is likely wrong
  - Options: `sleeper-overrides.json`, position corrections in `fixups.json`, manual position field on Player model
