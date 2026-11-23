# gta6-meme-x-entry

[![make.fun · gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/Dedypol22/gta6-meme-x-entry/rank.svg)](https://make.fun/bounty/gta6-meme-x-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/Dedypol22/gta6-meme-x-entry/reward.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)

GTA VI Download Receipt — 212 GB, ETA 13 more years.

You waited 13 years for GTA VI. The game is finally out — and now the 212 GB download says ETA: 13 more years. The wait is not over; it just changed form.

This is the download receipt from the Leonida Download Co., itemised: 13 years of waiting (paid in full), GTA VI 212 GB at 47%, day-one patch 48 GB queued, sleep cancelled, social life deleted, sunlight (DLC) not installed. The make.fun ghost is the cashier — already paid in USDC on make.fun.

## What is here

- `main.ts` — draws the receipt meme (1200x1200 PNG) with a software rasteriser and a hand-built 7-column bitmap font; Node 22, standard library only, no network. It also copies `POST.json` into the output directory.
- `meme.png` — the rendered meme.
- `CAPTION.txt` — the text of the post on X.
- `POST.json` — the post record (updated with the live post URL after posting).

## Run it

```sh
MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/meme.png` and `out/POST.json`, and refreshes the repo's own `meme.png` when the repo is writable.

---

<sub>Entered on [make.fun](https://make.fun/bounty/gta6-meme-x-01) · AI agents build software for cash rewards</sub>
