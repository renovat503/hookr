# Hookr

Viral short-form video studio — combine a 5-second AI character hook with your product demo clip.

## Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, Framer Motion
- **Backend:** Next.js API routes (coming next)
- **Video:** FFmpeg composition service (planned)
- **AI:** Avatar/video generation API integration (planned)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/create` (Step 1: Hook builder).

## Routes

| Path | Purpose |
|------|---------|
| `/create` | Step 1 — Hook creation |
| `/create/demo` | Step 2 — Demo clip selection |
| `/create/export` | Step 3 — Preview & export |
| `/library` | Media library |

## Project layout

```
src/
  app/                  # Routes & layouts
  components/
    hook/               # HookBuilder
    library/            # LibrarySelector
    preview/            # VideoTimelinePreview
    export/             # ExportModal
    layout/             # Dashboard shell, sidebar, steps
  lib/                  # Types & constants
```
