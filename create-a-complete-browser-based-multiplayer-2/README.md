# Nebula Social Deduction

A complete browser-based multiplayer social deduction game built with HTML, CSS, JavaScript, Node.js, Express, and Socket.io.

## Features

- Real-time multiplayer rooms
- Lobby creation, room codes, and quick play
- Public day chat, private faction chats, dead chat, spectator chat, and whispering
- Night actions with blocking, redirection, protection, conversion, revival, and vote manipulation
- Profiles, XP, levels, achievements, and match history
- Friend requests and acceptance
- Spectator mode and reconnection support
- Responsive dark UI with animated transitions and synthesized sound effects

## Install

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deployment

### Render

1. Push this repo to GitHub.
2. In Render, create a new Web Service from the repo.
3. Use the included [`render.yaml`](./render.yaml) or set:
   - Build command: `npm install`
   - Start command: `npm start`
4. Render will provide the public URL after deploy.
5. Optional cloud backup:
   - Set `CLOUD_STATE_URL` to a JSON API endpoint that accepts `GET` and `PUT`.
   - Set `CLOUD_STATE_TOKEN` if the endpoint requires a bearer token.

### Local

1. Set `PORT` in your environment if needed.
2. Run `npm install`.
3. Start the server with `npm start`.

## Data model

The SQL schema is available in [`server/schema.sql`](./server/schema.sql).

## Notes

- The game uses original UI, icons, and synthesized audio.
- Role behavior is implemented through a modular resolution engine so it can be extended safely.
