# TravelMap

TravelMap is a React + Vite travel map PWA for saving places, planning trips, and managing travel memos with optional Supabase sync.

## Features

- AMap place search, map view, city switch, and route planning
- Save places and group them by city
- Build custom trips, reorder stops, and configure transport per segment
- Travel memo checklist with reusable templates
- Supabase email OTP login, guest mode, and cloud sync

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
```

Notes:
- `VITE_SUPABASE_KEY` is public anon key by design; make sure your Supabase tables are protected with strict RLS policies.

## Scripts

```bash
npm run lint
npm run build
npm run preview
```
