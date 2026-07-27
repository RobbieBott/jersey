# Jersey number picker

Static page + one Netlify Function. The roster lives in Netlify Blobs, so no database to set up.

## Deploy

Drag-and-drop will NOT work — the function needs its dependency installed at build time.

1. Push this folder to a GitHub repo.
2. Netlify > Add new site > Import an existing project > pick the repo.
3. Build command: leave blank. Publish directory: `.` (netlify.toml already sets it.)
4. Deploy. The board is at `/`, the function answers at `/api/roster`.

Or from your machine: `npm install && npx netlify deploy --prod`

## Coach PIN

Two options:

- Set `COACH_PIN` in Netlify > Site configuration > Environment variables. Recommended — the PIN never lives in the roster data.
- Or leave it unset and open the coach view yourself first: the first PIN entered is the one that sticks.

## Clearing the roster for a new season

Coach view > Clear all picks. Or delete the `roster` key in Netlify > Blobs > `jersey`.
