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
numeric ordering, and percentages use their unrounded values. Equal values retain
the site's original order. Team names initially sort alphabetically.

Sorting applies to all standings groups in the selected tab without moving teams
between divisions, conferences, or existing wild-card qualification groups. League
view sorts the entire league. Rank reflects descending 3-point PTS within each
group, even when another column is sorted. The selected sort is reapplied after
tab or date changes.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository.
5. Navigate to any NHL standings page, e.g.  
   `https://www.nhl.com/standings/2025-03-31/wildcard`

The extension activates automatically on all URLs matching  
`https://www.nhl.com/standings/*`.

## Development

```bash
# Install dev dependencies
npm install

# Run tests
npm test
```