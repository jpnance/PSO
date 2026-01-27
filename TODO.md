# PSO Backlog

## High Priority
*Before Feb 7 trade window opening*

- [ ] **Polish the trading experience** - critical path for owner adoption
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
- [ ] Full standings page ⚡ *quick win*
- [ ] Schedule/results page (maybe special case of `/history`?) ⚡ *quick win*

### Migrations (existing features → new setup)
- [ ] Integrate `/history` into the new setup *(navbar is easy; polish is not)*
- [ ] Integrate `/h2h` into the new setup *(navbar is easy; polish is not)*
- [x] Integrate `/jaguar` into the new setup
- [ ] Integrate `/simulator` into the new setup *(already responsive, may be close)*
- [ ] Route consistency: `/franchise/:rosterId` → `/franchises/:id` (add `/franchises` landing page?) ⚡ *quick win*

### Trading & Transactions
- [ ] Extract `buildValidationParties(deal)` helper — same "deal → parties with contract lookups" logic exists in 3 places
- [x] Should budget impact on a hypothetical/proposed trade be baked into the trade details?
- [x] Update proposal page to use inline budget impact style (match trade machine)
- [x] Re-add cash-neutral button somewhere — now in action footer with "Make Cash-Neutral for [year]"
- [ ] Maybe "vetoed" should be a status when the commissioner rejects a trade?
- [ ] Improve commissioner trade approval screen (currently bare-bones)
- [ ] Figure out how to deal with locked players in trades
- [ ] Figure out a data backfill strategy to get more past transactions into the system
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
- FA pickup/cut rollback (missing contract term storage in `droppedPlayerSchema`)
- Auction rollback (RFA state complexity)

## Lower Priority
*Nice to have, no hard deadline*

### Historical Data Reconstruction
- [ ] Parse `data/archive/` files to reconstruct early league history (2008-2009)
  - XML files have contract snapshots with player IDs, salaries, and team assignments
  - Auction chat logs have the full bidding record from founding draft
  - `results.html` has complete 2008 auction picks in order
  - Could seed historical contracts into the database for complete league timeline
  - See `data/archive/README.md` for full inventory and `parse-xml-contracts.js` for initial parsing

### Information & Content
- [ ] Bring the rules document over to the website
- [ ] General transaction log
- [ ] Season overview page
- [ ] Player cards - click into to see player details and transaction history
- [ ] Tool for owners to query past results
- [ ] League Hall of Fame

### UI/UX Polish
- [ ] Make the site more uniform looking
- [ ] Improve icons in the navbar for small breakpoints
- [ ] Admin players page - more mobile-friendly (smaller text, college truncation)
- [ ] Admin players page - make college editable for historical players
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
- [ ] Consider E2E testing with Playwright
- [x] Add sandbox message banner to league config seed

## Ideas / Someday
*Experiments, long-term vision, not committed*

### UI/UX Experiments
- [ ] Experiment with color schemes (themed to Summer Meetings location each year?)
- [ ] Breadcrumbs in Coinflipper app style
- [ ] Tighten up draft picks widget on franchise page (3 columns? conflicts with showing results)
- [x] Revisit naming for `/propose` and `/trades` - resolved: `/trade-machine`, `/proposals/:slug`, `/trades`, `/trades/:id`
- [ ] Trade display: two columns at larger breakpoints? (let multi-party asset lists flow naturally)

### Misc Ideas
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

---

## Recently Completed
*Keep a short log for context and momentum.*

### Jan 17, 2026
- Franchise Timeline: New page (`/timeline`) — Wikipedia-style ownership history chart
- Franchise Timeline: CSS Grid visualization with 12×12px cells, 1px gaps
- Franchise Timeline: Legend highlights matching franchise cells on hover
- Franchise Timeline: Mobile-friendly with horizontal scroll and legend above chart
- Franchise Timeline: Added to History & Results nav section
- Jaguar Chart: Migrated to new layout system with `+seasonNav` component
- Jaguar Chart: Redesigned as mobile-responsive 2x2 owner card grid (no horizontal scrolling)
- Jaguar Chart: Each card shows opponent matchups with individual game differentials and totals
- Jaguar Chart: Added test suite validating standings logic against 14 seasons of historical data
- Jaguar Chart: Cleaned up CSS from 735 lines to 115 lines (removed unused mockup styles)
- Position badges: Added `white-space: nowrap` and `flex-shrink: 0` to prevent text wrapping on mobile

### Jan 16, 2026
- Trade Machine: Added `?from=<proposal-slug>` API to pre-populate from existing proposal
- Trade Machine: Auto-select current user's franchise on fresh trade machine
- Trade Machine: Show warning when pre-populated assets have moved since original deal
- Proposal page: Added "Reject & Counter" button (rejects then opens Trade Machine with those assets)
- Proposal page: Action buttons now wrap properly on mobile with BEM styling (`.proposal-actions`)
- Removed counter-offer infrastructure (schema fields, route, function, views, CSS)
- Updated `.cursorrules`: clarified BEM usage — don't target Bootstrap classes directly

### Jan 14, 2026
- Trade Machine: Redesigned budget impact as compact table (ledger style with year columns)
- Trade Machine: Moved action buttons (Propose/Share/Cash-Neutral) to card-footer
- Trade Machine: "Make Cash-Neutral for [year]" button — honest about scope, hides when already neutral
- Trade Machine: Removed separate Budget Impact card (now inline at bottom of trade details)
- Upgraded Font Awesome from 4.3.0 to 4.7.0

### Jan 13, 2026
- Trade Machine: Fixed budget impact card flash (show after content loads)
- Trade Machine: Hide "Propose Trade" button during dead period
- Trade Machine: Notes field now admin-only
- Proposal page: Removed Delete button (drafts auto-cleanup in 7 days)
- Proposal page: Updated hypothetical trade copy
- Proposal page: Removed redundant Cash Neutral badge

