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
| **RW** | Removed (data now shown in the W column) |
| **ROW** | Removed |
| GP, GF, GA, DIFF, HOME, AWAY, S/O, L10, STRK | Unchanged |

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