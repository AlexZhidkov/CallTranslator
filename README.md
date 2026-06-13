# Call Translator

Audio-only multilingual family call translator built with React, LiveKit Cloud, and Gemini Live Translate.

Participants choose the language they speak and hear. The first user starts a
call and joins immediately; users opening the shared link choose their language
and join the same room.

Only one participant can speak at a time using a tap-to-claim floor control.

Firebase Hosting serves the Vite React app. API requests under `/api/**` are handled by a Cloud Run Node.js backend that manages rooms, LiveKit tokens, turn locking, and Gemini Live API translation bridges.

The frontend is installable as a Progressive Web App. It includes a web app manifest, app icons, and a service worker that caches the app shell and static assets. Calls and translation still require a live network connection because `/api/**`, LiveKit, and Gemini traffic are never served from cache.

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
2. Confirm the language selector defaults to your browser/system language, or select another supported language.
3. Click `Start Call`.
4. Confirm the first window connects and shows the share row.
5. Copy the room link.
6. Open the link in the second browser profile.
7. Select the second participant's language.
8. Click `Join Call`.
9. In the first window, press the speak button, speak, then press `Done`.
10. Confirm the second participant hears translated audio in their selected language.
11. In the second window, press the speak button, speak, then press `Done`.
12. Confirm the first participant hears translated audio in their selected language.

Expected behavior:

- No camera permission is requested.
- Microphone is enabled only while the active participant has the floor.
- The other participant cannot speak until the current participant presses `Done`.
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

- Each participant chooses a target language from the Live Translate supported-language list.
- When one participant speaks, the backend starts Gemini translation bridges for
  selected languages used by participants assigned to the other internal room
  role.
- Each bridge streams PCM audio to `gemini-3.5-live-translate-preview` with its `targetLanguageCode`.
- Translated audio is published back to LiveKit as `translator-<language-code>`.
- Participants subscribe to the translator track that matches their selected language.

## UI Translations

Interface copy lives in `src/i18n.js`. To add a UI language, add an entry to
`UI_LOCALES` and a matching catalog in `UI_TRANSLATIONS` with the same keys as
`en`. The participant's selected language controls both the interface language
and the spoken translation target. If interface strings are missing for that
language, the UI falls back to English.

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
