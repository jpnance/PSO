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
  - [ ] Cash assets in trades should use formatMoney
  - [ ] Show cap violation warnings in Budget Impact widget
- [ ] Allow owners to drop players *(if needed for Feb 7, otherwise Medium)*

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
- [ ] Integrate `/history` into the new setup ⚡ *quick win - already works*
- [ ] Integrate `/h2h` into the new setup ⚡ *quick win - already works*
- [ ] Integrate `/jaguar` into the new setup ⚡ *quick win - already works*
- [ ] Integrate `/simulator` into the new setup ⚡ *quick win - already works*

### Trading & Transactions
- [ ] Figure out how to deal with locked players in trades
- [ ] Figure out a data backfill strategy to get more past transactions into the system

## Lower Priority
*Nice to have, no hard deadline*

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
- [ ] Improve layout of info banners across the site

### Infrastructure & Technical
- [ ] Figure out a better way to structure database reports
- [ ] Clean up directory structure
- [ ] Add generic error pages (404, 500, etc.)
- [ ] Consider E2E testing with Playwright

## Ideas / Someday
*Experiments, long-term vision, not committed*

- [ ] Rename "admin" to "commissioner" or "commish" throughout (for fun)
- [ ] Consider having roles specific to PSO ("commish", "podcast host")
- [ ] Bring PSO Show podcast notes into the 21st century
- [ ] Consider a better schedule generation experience
- [ ] Fantasy prep tools improvements (maybe separate from PSO?)
- [ ] Get a real league logo
- [ ] Implement a simple blog feature
- [ ] Figure out how to support Colbys basketball league

---

## Recently Completed
*Keep a short log for context and momentum.*

### Jan 13, 2026
- Trade Machine: Fixed budget impact card flash (show after content loads)
- Trade Machine: Hide "Propose Trade" button during dead period
- Trade Machine: Notes field now admin-only
- Proposal page: Removed Delete button (drafts auto-cleanup in 7 days)
- Proposal page: Updated hypothetical trade copy
- Proposal page: Removed redundant Cash Neutral badge