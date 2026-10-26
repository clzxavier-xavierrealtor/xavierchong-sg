# xavierchong.sg

Xavier Chong's 3D project explorers. Cloudflare Pages serves the `site/` folder.

## Layout
- `site/` — the live website. `site/<project>/` holds each explorer (built `index.html`, `data.json`, `assets/`, `engine/`).
- `engine/` — the shared 3D engine source (`src/*.js`, `engine.css`). Built into each project by `build.mjs`.
- `tools/` — data builders: `build_data.py` turns a project's inputs into `site/<project>/data.json`.
  - `tools/projects/<slug>.json` — stacks traced from the site plan, blocks, unit types, agent, facts.
  - `tools/projects/<slug>.content.json` — facilities, clubs, drone views, factsheet.
  - `tools/projects/<slug>.prices.xlsx` — optional indicative price matrix ("All Units" sheet).
  - `tools/geo/` — site-plan → map fit, OSM lot, bus stops, MRT exits, OSM surroundings.
- `projects.json` — projects to build, with page titles and the Google Maps key (website-restricted key).

## Rebuild
```
npm install
python3 tools/build_data.py thomson-reserve
node build.mjs
```

## Cloudflare Pages settings
Framework preset: None · Build command: (empty) · Build output directory: `site`
