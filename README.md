# Taskboard

A Trello-style application where users manage projects, stages and tasks.
Built with vanilla JavaScript ES modules, Vite, Bootstrap and Supabase.

## Setup

```powershell
npm install
Copy-Item .env.example .env   # then fill in your Supabase values
npm run dev
```

## Scripts

- `npm run dev` – start the dev server
- `npm run build` – production build to `dist/`
- `npm run preview` – preview the production build

## Structure

- `src/` – application code (`pages/`, `components/`, `services/`, `utils/`)
- `supabase/migrations/` – SQL migrations
- `scripts/` – helper scripts

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for architecture rules.
