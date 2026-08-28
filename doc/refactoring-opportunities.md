# Refactoring Opportunities: Extract Domain Predicates

Audit performed August 2026. The codebase uses `.lean()` extensively, returning plain objects from Mongoose queries. Domain logic that would traditionally live in instance methods is instead inlined as raw property checks, duplicated across many files.

## Tier 1: Contract State Predicates

**Home:** `helpers/contract.js` (already exists with `isUnsigned`, `contractAffectsSeason`, `getEffectiveYears`, `getEffectiveEndYear`)

**Problem:** The codebase constantly classifies contracts into states by checking raw properties. The same three-way branch (RFA / unsigned / signed) appears across many services, and secondary checks (expiring, expired) are also scattered.

### `isRfa(contract)` — ~25 occurrences

Check: `contract.salary === null`

Used to: filter RFA rights from rosters, skip RFA in budget calculations, exclude from roster limits, display "RFA Rights" text.

Files: `services/league.js`, `services/proposals.js`, `services/transaction.js`, `services/admin.js`, `services/players.js`, `services/auction-admin.js`, `services/free-agents.js`, `services/admin-prep.js`, `helpers/budget.js`, `helpers/contract.js`, `views/admin-player-edit.pug`

### `isUnsigned(contract)` — ~12 occurrences (helper exists but is never called)

Check: `contract.salary !== null && !contract.endYear`

Used to: identify players who've been drafted/auctioned but haven't had their contract term set yet.

Files: `services/proposals.js` (3 checks in one block), `services/league.js` (2×), `services/admin.js`, `services/auction-admin.js`, `helpers/view.js`, `public/js/trade.js` (2×), `public/js/franchise.js`

### `isSigned(contract)` — implicit everywhere

Check: `contract.salary !== null && !!contract.endYear`

The "else" branch of the RFA/unsigned checks. Not explicitly tested for but would clarify intent.

### `isExpiring(contract, season)` — ~6 occurrences

Check: `contract.endYear === season`

Files: `views/franchise.pug`, `services/admin.js` (2×), `public/js/franchise.js`, `data/rfa/generate.js`

### `isExpired(contract, season)` — ~4 occurrences

Check: `contract.endYear && contract.endYear < season`

Files: `services/auction-admin.js`, `services/admin.js`, `helpers/contract.js`, `services/league.js`

### `hasPendingContractChoice(contract)` — 2 occurrences

Check: `!contract.endYear && contract.pendingEndYear`

Files: `services/league.js` (lines 864–866, 2103–2105)

### `qualifiesForRfa(contract, season)` — 4 parallel implementations

Check: contract length 2–3 years (post-2018) or any length (pre-2018). Currently implemented differently in `services/admin.js` (2×), `data/seed/rfa-conversions.js`, `data/rfa/generate.js`. The seed version includes era-specific rules the production version doesn't — worth reconciling.

### `partitionContracts(contracts)` — 4 occurrences

Pattern: `var actual = contracts.filter(c => c.salary !== null); var rfa = contracts.filter(c => c.salary === null);`

Files: `services/league.js` (2×), `services/admin.js` (2×)

---

## Tier 2: Regime Tenure Lookups

**Home:** new `helpers/regime.js`

**Problem:** The single most duplicated block in the codebase. Six service files define their own local function with the same body. Another ~10 call sites inline it without even a local function.

### `findRegimeForFranchise(regimes, franchiseId, season)` — ~18 occurrences

Pattern:
```javascript
regimes.find(function(r) {
    return r.tenures.some(function(t) {
        return t.franchiseId.toString() === fIdStr &&
            t.startSeason <= season &&
            (t.endSeason === null || t.endSeason >= season);
    });
});
```

Local function copies: `getDisplayName` in `services/draft-live.js`, `services/draft.js`, `services/auction-results.js`; `getFranchiseName` in `services/proposals.js`; `getRegimeAtTime` in `services/trades.js`; `getRegimeName` in `services/league.js`, `services/cuts.js`; `getRegimeForFranchise` in `services/players.js`

Inline (no local wrapper): `services/league.js` (3×), `services/admin.js` (5×), `services/proposals.js` (1×)

### `findCurrentRegime(regimes, franchiseId)` — ~8 occurrences

Variant with no season check — just `endSeason === null`.

Files: `services/auction-admin.js`, `services/admin.js`, `services/players.js`

### `buildCurrentRegimeMap(regimes)` — ~6 occurrences

Pattern: iterate regimes and active tenures, build `{ franchiseId: displayName }` map.

Files: `services/trades.js`, `services/free-agents.js`, `services/league.js`, `services/admin-prep.js`, `auction/index.js`, `data/maintenance/verify-budgets.js`

### `getActiveFranchiseIds(regimes)` — 2 occurrences

Pattern: collect all `franchiseId` values from tenures where `endSeason === null`.

Files: `services/proposals.js`, `services/auction.js`

### `getUserFranchiseIdsForSeason(userId, season)` — 2–3 occurrences

Complex pattern: query regimes by `ownerIds`, populate `tenures.franchiseId`, filter tenures covering the season, extract `rosterId` values. Duplicated between `services/schedule.js` and `services/standings.js`.

---

## Tier 3: Game State Predicates

**Home:** new `helpers/game.js`

**Problem:** Game completion, type classification, and winner determination are checked inline throughout schedule and standings code.

### `isGameComplete(game)` — ~24 occurrences

Check: `game.away.score != null && game.home.score != null`

Note: ~6 places use only `game.away.score != null` as a proxy. Worth unifying.

Files: `services/schedule.js` (7×), `services/standings.js` (4×), `services/league.js` (1×), `helpers/schedule.js` (7×), `helpers/standings.js` (2×), `helpers/tiebreaker.js` (1×), `views/mixins.pug` (1×)

### `isPlayoffGame(game)` — ~10 occurrences

Check: `['semifinal', 'championship', 'thirdPlace'].includes(game.type)`

Already exists as a local function in `data/analysis/playoffRecords.js` but not shared.

Files: `services/schedule.js` (3×), `services/standings.js` (3×), `services/league.js` (1×), `helpers/standings.js` (1×), `data/analysis/seasons.js` (1×)

### `isRegularSeasonGame(game)` — ~7 occurrences

Check: `game.type === 'regular'`

### `getGameWinner(game)` — ~34 occurrences of score comparison logic

Pattern: `away.score > home.score` / `home.score > away.score` with null guards. Returns `'away' | 'home' | 'tie' | null`.

The W/L/T increment block (assign wins/losses/ties to both sides) is duplicated in 6 places across `services/schedule.js`, `services/standings.js`, `helpers/schedule.js`, `helpers/standings.js`, `helpers/tiebreaker.js`.

### `getPlayoffGameLabel(type)` — 3 occurrences

Pattern: `type === 'semifinal' ? 'Semifinal' : (type === 'championship' ? 'Championship' : 'Third Place')`

Note: inconsistent — one use says "3rd Place" instead of "Third Place".

### `PLAYOFF_TYPE_ORDER` — 3 occurrences

Pattern: `{ semifinal: 1, championship: 2, thirdPlace: 3 }`

### Playoff finish assignment — 3 near-identical ~50-line blocks

Pattern: iterate playoff games, assign `'fourth-place'` for semifinal participants, then `'third-place'`, `'champion'`, `'runner-up'` based on scores.

Files: `helpers/standings.js`, `services/standings.js`, `data/analysis/seasons.js`

### `isPlayoffTeam(franchiseRosterId, season)` — 3 occurrences

Pattern: `Game.exists({ season, type: 'semifinal', $or: [{ 'away.franchiseId': id }, { 'home.franchiseId': id }] })`

Used for playoff-FA cut eligibility. Files: `services/league.js` (2×), `services/transaction.js` (1×)

---

## Tier 4: Lookup Map Building

**Home:** new `helpers/lookup.js` or extend existing helpers

**Problem:** The same `forEach` → bracket-assignment pattern for building ID-keyed maps is repeated for franchises, players, contracts, and budgets.

### `indexById(items)` — generic utility

Would replace: `franchiseById` (6×), `playerMap` (7×), `contractByPlayer` (6×)

### `POSITION_ORDER` duplication — 18 files

Already exported from `helpers/view.js` but re-declared locally everywhere. Just needs imports.

### `buildOwnerNameToFranchiseMap(regimes, franchises, season)` — 4 copies in seed scripts

---

## Tier 5: Proposal Logic

**Home:** new `helpers/proposal.js` or extract within `services/proposals.js`

### Proposal status predicates — ~20 occurrences across service + views

- `isProposalOpen(status)` — `status === 'hypothetical' || status === 'pending'`
- `isProposalMutable(status)` — same (for accept/reject/cancel guards)
- `isProposalTerminal(status)` — rejected, canceled, expired, executed

### `isUserParty(proposal, userFranchiseIds)` — 6 occurrences in `services/proposals.js`

### `proposalToDeal(proposal)` — 2 copy-paste blocks (~150 lines each)

Converts proposal parties into the `deal` format for `calculateTradeImpact`. Duplicated between `viewProposal` and `listProposalsForApproval`.

### `buildProposalPartiesDisplay(proposal)` — 2 massive copy-paste blocks

Asset building (players, RFA, picks, cash) for display. ~150 lines each, duplicated between the same two functions.

---

## Tier 6: Season Phase Logic

**Home:** `models/LeagueConfig.js` (extend existing methods)

### Phase arrays duplicated inline — 3–5 each

- Offseason phases: `['dead-period', 'early-offseason', 'pre-season']` (3×)
- Trade-enabled phases: duplicated inline in `services/players.js` despite existing `areTradesEnabled()` method
- Post-auction phases: `['regular-season', 'post-deadline', 'playoff-fa', 'dead-period']` (1×, but bespoke)

### Owner action guards — 4 occurrences

- `canMarkForCut` = `isOwner && phase === 'early-offseason'`
- `canSetContracts` = `isOwner && phase === 'pre-season'`
