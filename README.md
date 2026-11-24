# Jaxcade

Free, instant-play browser games. Live at **https://jackiscool153.github.io/**

| Game | Where | What |
|---|---|---|
| **STRIKEPOINT** | `play/strikepoint/` | Online arena FPS. The page embeds the live Node server at https://strikepoint-ykix.onrender.com (source: [Jackiscool153/strikepoint](https://github.com/Jackiscool153/strikepoint)). |

Everything is plain static HTML/CSS/JS — no build step. GitHub Pages serves the `main` branch root.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Add a game

1. Put the game in `games/<id>/` (or a wrapper page in `play/<id>/` for an externally hosted game).
2. Add a screenshot to `img/<id>.jpg` (16:9).
3. Add an entry to `js/games.js`.

## Custom domain (later)

1. Get a domain or free subdomain (e.g. `jaxcade.example.com`, or a free `*.is-a.dev` subdomain via a PR to https://github.com/is-a-dev/register).
2. DNS:
   - **Subdomain** (`games.example.com`): add a `CNAME` record → `jackiscool153.github.io`
   - **Apex** (`example.com`): `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (optionally `AAAA` → `2606:50c0:8000::153` … `8003::153`)
3. Add a file named `CNAME` at the repo root containing just the domain (e.g. `games.example.com`), or set it in **Settings → Pages → Custom domain**.
4. Once the certificate is issued, tick **Enforce HTTPS**.
5. Recommended: verify the domain under your GitHub account settings → Pages to prevent takeovers.

All site links are relative, so nothing else needs to change when the domain changes.
