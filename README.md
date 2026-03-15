# tool_chat_in_myself

A local-first thinking organizer for "inner debate" style multi-persona chat.

## Stack

- Frontend: Next.js + React
- Backend: FastAPI
- Database: SQLite
- Auth: intended to be handled by Caddy Basic Auth on the host side

## Features in this scaffold

- Fixed speakers with the requested colors
- Room list with latest speaker and unresolved memo mark
- Chronological / threaded message view
- Reply posting
- Room memo editing
- Speaker / keyword / reply-state filtering
- Mobile-friendly single-column reading layout

## Run backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The SQLite file is created automatically at `backend/chat.db`.

## Run frontend

```bash
cd frontend
npm install
npm run dev
```

If needed, set `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000`.
