# nhl-standings-extension

A Chrome extension that modifies the NHL standings table on [NHL.com](https://www.nhl.com/standings/) to display standings using a **3-point win system**:

| Result | Points |
|---|---|
| Regulation Win (W) | 3 |
| OT / Shootout Win (OTW) | 2 |
| OT / Shootout Loss (OTL) | 1 |
| Regulation Loss (L) | 0 |

## Column changes

| Column | Change |
|---|---|
| **W** | Updated — now shows **regulation wins only** (source: `RW`) |
| **OTW** | **New** — OT/shootout wins (`W − RW`) |
| **OTL** | Renamed from `OT` |
| **L** | Unchanged |
| **PTS** | Recomputed as `W×3 + OTW×2 + OTL×1` |
| **P%** | Recomputed as `PTS ÷ (GP × 3)` |
| **DPTS** | **New** — dumb points, using NHL's real-world 2-point system: `2 × (W + OTW) + OTL` |
| **DP%** | **New** — dumb points percentage: `DPTS ÷ (GP × 2)` |
| **RW** | Removed (data now shown in the W column) |
| **ROW** | Removed |
| GP, GF, GA, DIFF, HOME, AWAY, S/O, L10, STRK | Unchanged |

PTS, P%, DPTS and DP% appear together. Percentages display three decimal places;
teams with no games played show `.000`.

## Sorting

Standings initially sort by **3-point PTS, descending**. Click a column header to
sort locally; click it again to toggle ascending/descending. Numeric columns use
numeric ordering, and percentages use their unrounded values. Team names initially
sort alphabetically. Only the active column is highlighted.

Division and conference views sort within their respective groups; league view
sorts the entire league. In wild-card view, the extension recalculates the top three
teams in each division, then ranks the remaining teams for the two wild-card spots
in each conference. Sorting PTS/P% selects the three-point playoff/ranking system;
DPTS/DP% selects the NHL two-point system. Other columns retain the last selected
system. Rank always reflects descending standings order, even while the display
is sorted ascending or by another statistic.

The wild-card cutoff appears **only when sorting PTS or DPTS**. It follows the
second wild-card qualifier: below that row in descending order, above it in
ascending order. The selected sort is reapplied after tab or date changes.

### Tie-breaking

For equal points in the selected system, rankings follow the page's published
procedure: fewer games played, more regulation wins (shown as W), more regulation
plus overtime wins (retained from the original ROW), then more total wins (W + OTW).
If a tie reaches head-to-head, the extension loads only the tied clubs' current-season
schedules (completed games through the selected date) and ranks by points earned in
games among them: regulation win 3, OT/SO win 2, OT/SO loss 1 for PTS, or the NHL
2-point scoring for DPTS. For two teams with an odd number of meetings, the first
game in the city with the extra home game is excluded. Remaining ties (or ties while
those games load or if they're unavailable) use NHL's official order, which applies
the goal-differential and goals-for tie-breakers. No prior-season results are fetched.

Team affiliations and official rankings are loaded from NHL's standings API for
the selected date and cached while the page is open. Loading or failure is shown
on the page; no playoff cutoff is shown until the groups can be recalculated.

The on-page legend explains the extension's displayed columns. Clinch/elimination
symbols remain NHL's official two-point-system results, not three-point projections.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository.
5. Navigate to any NHL standings page, e.g.  
   `https://www.nhl.com/standings/2025-03-31/wildcard`

The extension activates automatically on all URLs matching  
`https://www.nhl.com/standings*`, including `/standings` without a trailing slash.

### Updating an unpacked installation

Chrome reads files from the exact folder selected with **Load unpacked**. A Git
worktree and the main checkout are separate folders; updating one does not update
the other. After updating the folder Chrome uses, click the extension's **Reload**
button at `chrome://extensions/`, then refresh the NHL standings tab. The extension
card should show **1.0.1**.

## Versioning

Every extension change must update the version consistently in `manifest.json`,
`package.json`, and both root version fields in `package-lock.json`. This release
groups the two-system standings, local sorting, playoff/tie-break corrections,
legend updates, and highlighting fixes into patch version **1.0.1**.

## Development

```bash
# Install dev dependencies
npm install

# Run tests
npm test
```