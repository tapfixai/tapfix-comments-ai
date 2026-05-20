# TapFix Comments AI

Web-only MVP for automatic YouTube comment moderation and replies.

## Stack

- React + Vite + TailwindCSS
- Node.js + Fastify
- PostgreSQL + Prisma schema
- Official YouTube OAuth/API placeholders

## Run

```bash
npm run dev
```

Backend skeleton:

```bash
cp .env.example .env
npm run server
```

## MVP Scope

Included: Dashboard, Comments, AI Settings, Safety Settings, Logs, safety filter, backend API skeleton, cron placeholder, Prisma schema.

Not included yet: real Google OAuth flow, real YouTube API calls, real OpenAI API call, PostgreSQL migrations.

## Production URLs

- Frontend: `https://comments.tapfixai.app`
- Backend API: `https://api-comments.tapfixai.app`
- Google OAuth callback: `https://api-comments.tapfixai.app/auth/google/callback`

## Netlify Frontend

Set this environment variable for the frontend site:

```bash
VITE_API_URL=https://api-comments.tapfixai.app
```

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```

## Railway Backend

Use Railway for the Node/Fastify API and PostgreSQL.

Required variables:

```bash
PORT=8080
WEB_ORIGIN=https://comments.tapfixai.app
PUBLIC_API_URL=https://api-comments.tapfixai.app
DATABASE_URL=<railway-postgres-url>
```

Later, add:

```bash
OPENAI_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://api-comments.tapfixai.app/auth/google/callback
```
# tapfix-comments-ai
