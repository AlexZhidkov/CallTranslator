# Call Translator

Audio-only Russian-English family call translator built with React, LiveKit Cloud, and Gemini Live Translate.

The app is designed for two sides:

- `Parents / Родители` speak Russian and hear Russian translations.
- `Grandchildren / Внуки` speak English and hear English translations.
- Only one side can speak at a time using a tap-to-claim floor control.

Firebase Hosting serves the Vite React app. API requests under `/api/**` are handled by a Cloud Run Node.js backend that manages rooms, LiveKit tokens, turn locking, and Gemini Live API translation bridges.

## Requirements

- Node.js 22+
- A Gemini API key
- A LiveKit Cloud project with URL, API key, and API secret
- Firebase CLI and Google Cloud CLI for deployment

## Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Then set:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
GEMINI_API_KEY=your-gemini-api-key
APP_PIN=123456
PORT=8080
```

Never expose these values in the browser. The React app gets LiveKit room tokens from the backend.

`APP_PIN` is a numeric PIN required to use the app. Every `/api/**` request (except `/api/health`) must include it, so users see a PIN screen before anything else. Repeated wrong attempts are rate-limited per IP. If `APP_PIN` is unset, the PIN check is disabled and the API is open.

## Local Development

Install dependencies:

```bash
npm install
```

Start the API backend:

```bash
npm run dev:api
```

Start the Vite frontend in another terminal:

```bash
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`. Vite proxies `/api` to `http://localhost:8080`.

## Manual Two-Participant Test

Use two browser profiles or two different browsers on the same machine.

1. Open `http://localhost:5173`.
2. Click `Create room / Создать комнату`.
3. Join the first window as `Parents / Родители`.
4. Copy the room link.
5. Open the link in the second browser profile.
6. Join the second window as `Grandchildren / Внуки`.
7. In the parents window, press `Speak Russian`, speak, then press `Done / Готово`.
8. Confirm the grandchildren side hears English translated audio.
9. In the grandchildren window, press `Speak English`, speak, then press `Done / Готово`.
10. Confirm the parents side hears Russian translated audio.

Expected behavior:

- No camera permission is requested.
- Microphone is enabled only while the active side has the floor.
- The other side cannot speak until the current side presses `Done`.
- Transcript items appear when Gemini returns transcription events.

For two physical devices, use the deployed Firebase Hosting HTTPS URL. Browser microphone access usually will not work from `http://<LAN-IP>:5173`.

## Scripts

```bash
npm run dev          # Vite frontend
npm run dev:api      # Backend with node --watch
npm run start        # Backend production entrypoint
npm run lint         # ESLint
npm run test:server  # Node server unit tests
npm run build        # Vite production build
npm run check        # lint + server tests + build
```

## Backend API

- `POST /api/rooms` creates a room.
- `GET /api/rooms/:roomId` returns room state.
- `POST /api/rooms/:roomId/token` creates a LiveKit participant token.
- `POST /api/rooms/:roomId/turn/start` claims the speaking floor.
- `POST /api/rooms/:roomId/turn/end` releases the floor and sends Gemini `audioStreamEnd`.
- `POST /api/rooms/:roomId/leave` removes a participant from in-memory room state.

Room state is in memory for v1, so deploy the backend as a single warm Cloud Run instance.

## Translation Flow

- Parents speak Russian.
- `translator-en` subscribes to the parents' LiveKit audio track.
- The backend streams PCM audio to `gemini-3.5-live-translate-preview` with `targetLanguageCode: "en"`.
- Translated English audio is published back to LiveKit.
- Grandchildren subscribe to `translator-en`.

The reverse path uses `translator-ru` and `targetLanguageCode: "ru"`.

## Firebase Hosting And Cloud Run

`firebase.json` keeps the static build in `dist` and rewrites `/api/**` to the Cloud Run service:

```json
{
  "source": "/api/**",
  "run": {
    "serviceId": "call-translator-api",
    "region": "asia-southeast1",
    "pinTag": true
  }
}
```

Build the frontend:

```bash
npm run build
```

Create the PIN secret once (pick your own digits):

```bash
printf '123456' | gcloud secrets create app-pin --data-file=-
```

Deploy the backend to Cloud Run with secrets:

```bash
gcloud run deploy call-translator-api \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 3600 \
  --no-cpu-throttling \
  --set-env-vars LIVEKIT_URL=wss://your-project.livekit.cloud \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest,APP_PIN=app-pin:latest
```

Deploy Firebase Hosting:

```bash
firebase deploy --only hosting
```

## Notes

- Access requires the shared numeric `APP_PIN`; there is no per-user sign-in. The PIN is enforced server-side on every API request and remembered in the browser after the first entry.
- Long calls depend on one Cloud Run process keeping LiveKit and Gemini WebSocket bridges alive.
- Use headphones during testing to reduce echo and accidental translated feedback.
