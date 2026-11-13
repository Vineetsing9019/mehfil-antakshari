# Mehfil: play Antakshari online with friends

Share a table link on WhatsApp and sing together. Take turns in an Antakshari game (2 to 6
singers, with lives, votes, hints and teams), or open a jam table (1 to 8 people) to sing
together with a song queue. Chat and react with emojis. Works in the browser and can be
installed on a phone.

Product brief and acceptance criteria: [docs/SPEC.md](docs/SPEC.md).

## Run it on your computer

```bash
npm install
npm start          # http://localhost:5090 (and https on your Wi-Fi address, port 5443)
npm test           # 35 acceptance checks on the server flows
npm run make-icons # regenerates the app icons (optional)
```

## Put it on the internet (free)

1. Push this repo to GitHub.
2. On render.com, create a **Web Service** from the repo. `render.yaml` sets the build and start commands.
3. For voices on mobile data, add a free TURN relay and set `ICE_SERVERS` to its JSON.
4. Open the `.onrender.com` address and share it.

Notes for hosting:
- The free plan sleeps when idle, so the first visit can take about 30 seconds.
- Free hosts reset their disk on restart. Profiles in `data.json` are kept only until the next restart.
  Before a public launch, move storage to a database (see SPEC section 7).

## Files

- `server.js`: lobby, tables, game rules, voting, chat, persistence, reports.
- `bots.js`: bot singers (made-up profiles, real song titles).
- `public/`: the web app (`index.html`, `app.js`, `app.css`), install files (`manifest.json`, `sw.js`).
- `tests/flow-test.js`: acceptance checks.
- `docs/SPEC.md`: the product spec.
