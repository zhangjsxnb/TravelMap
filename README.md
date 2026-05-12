# TravelMap

TravelMap is a React + Vite travel map PWA for saving places, planning trips, and managing travel memos with optional Supabase sync.

## Features

- AMap place search, map view, city switch, and route planning
- Save places and group them by city
- Build custom trips, reorder stops, and configure transport per segment
- Travel memo checklist with reusable templates
- Supabase email OTP login, guest mode, and cloud sync
- AI trip planning through backend proxy (avoid exposing AI vendor key on frontend)

## Local development

```bash
npm install
npm run dev
```

## Environment variables

Set these in `.env`:

```env
VITE_AMAP_KEY=
VITE_AMAP_JSCODE=
VITE_SUPABASE_URL=
VITE_SUPABASE_KEY=
VITE_AI_PLAN_API_URL=

# Backend-only variables (server runtime)
ALIYUN_API_KEY=
ALIYUN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_MODEL=qwen-plus
AI_PLAN_BEARER_TOKEN=
```

Notes:
- `VITE_AI_PLAN_API_URL` should point to your own backend endpoint (for example `/api/ai/plan`).
- `AI_PLAN_BEARER_TOKEN` is required by `api/ai/plan.js` and must be sent by frontend via `Authorization: Bearer <token>`.
- `VITE_SUPABASE_KEY` is public anon key by design; make sure your Supabase tables are protected with strict RLS policies.

## AI API contract (recommended)

Frontend sends `POST` JSON:

```json
{
  "action": "plan",
  "prompt": "Relaxed weekend plan with cafe and park",
  "city": "Shanghai",
  "places": [
    { "id": "p1", "name": "Wukang Mansion", "category": "Attraction", "address": "..." }
  ],
  "currentTrip": null,
  "preferences": {
    "dayStartAt": "10:00",
    "targetStopsPerDay": 6
  }
}
```

Recommended response:

```json
{
  "proposal": {
    "summary": "Relaxed route with less cross-district travel",
    "routes": [
      { "title": "Day 1", "placeIds": ["p1", "p2", "p3"] }
    ],
    "goodieBag": [
      { "name": "Cafe Name", "hint": "Great for afternoon break" }
    ]
  }
}
```

## Scripts

```bash
npm run lint
npm run build
npm run preview
```
