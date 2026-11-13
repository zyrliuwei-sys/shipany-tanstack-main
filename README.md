# Application

A headless SaaS engine for building AI-powered products with Claude Code, on
TanStack Start. Pre-wired business logic (payments, credits, subscriptions,
auth, RBAC, i18n, CMS) with minimal UI — you build your product pages on top.

## Quick Start

```bash
pnpm install
cp .env.example .env.development   # then fill in the values (AUTH_SECRET etc.)
pnpm db:push
pnpm rbac:init --admin-email=admin@example.com --admin-password=your-password
pnpm dev
```

Open `http://localhost:3000`, sign in with the admin account, and configure
payments, login providers, email, storage and AI at `/admin/settings`.

> Local env lives in `.env.development` (gitignored). It is loaded by both Vite
> and the `db:*` scripts. Only `VITE_APP_URL`, `VITE_APP_NAME`,
> `DATABASE_PROVIDER`, `DATABASE_URL`, and `AUTH_SECRET` are required to boot.

## Features

- **Auth** — Email/password, Google/GitHub OAuth and Google One Tap via better-auth
- **Payment** — Stripe, Creem, PayPal, Alipay, WeChat Pay: checkout, subscriptions, webhooks, refunds, coupons. Every grant is atomic and idempotent
- **Credits** — FIFO consumption, expiration, auto-grant on signup, refunds
- **Guest posts** — Paid articles: authors pay to submit, admins approve, request changes or reject with a refund; published with sponsored links
- **Support tickets** — User tickets with a floating support button and an admin inbox
- **AI** — Replicate, Gemini, Fal, Kie providers with task tracking and credit deduction
- **RBAC** — Roles, permissions, wildcard matching, admin management
- **Agent API** — Scoped admin tokens, an MCP server and an audit log, so agents can run the back office
- **API keys & invite codes** — Key CRUD + validation; trial invite codes with batch generation
- **CMS & blog** — Categories and posts, Markdown blog, MDX static pages
- **Bot notifications** — Telegram / Feishu / WeCom messages for payments, tickets and guest posts
- **i18n** — English-only UI and content via Paraglide JS; legacy `/zh` links redirect to English
- **Appearance** — Optional admin-controlled color themes, font, size, sidebar layout and light/dark
- **Database** — SQLite, PostgreSQL, MySQL, Turso and Cloudflare D1 via Drizzle ORM
- **Deploy anywhere** — Node server, or Cloudflare Workers with D1 or Postgres via Hyperdrive
- **All code self-contained** — no external packages for business logic

## Tech Stack

- TanStack Start (Vite 8 + nitro, React 19, TypeScript)
- TanStack Query, Form, and Table for data, forms, and tables
- shadcn/ui v4 (Base Nova style, Tailwind CSS 4)
- better-auth + Drizzle ORM
- Paraglide JS for i18n

## Project Structure

```
src/
├── core/           # Infrastructure (db, auth, payment, email, storage, ai, notify, i18n)
├── modules/        # Business logic (payment, credits, subscriptions, guest-posts, apikeys, rbac, ...)
├── config/         # Env, DB schema templates, pricing catalog, feature defaults
├── routes/         # File-based routes (English-only, locale-free paths)
│   ├── settings/   # User center
│   ├── admin/      # Admin panel
│   └── api/        # Server routes (REST endpoints)
├── server/         # Server-only helpers shared by routes (admin ops, payment, ...)
├── blocks/         # Page sections that read i18n (disposable demo content)
├── components/     # Reusable UI, content via props (durable)
├── content/        # MDX static pages and blog posts
├── hooks/          # Shared react-query hooks
└── lib/            # Utilities (api-client, query-client, hash, resp, rate-limit, ...)

messages/en.json    # Translation source (flat dot-keyed)
project.inlang/          # Inlang project config
src/paraglide/           # Compiled messages + runtime (gitignored, generated)
```

## User Center & Admin Panel

The user center (`/settings`) has profile, credits, billing, payments, API
keys, support tickets and guest posts. Optional pages can be switched off at
Settings → Users.

The admin panel (`/admin`):

| Section  | Pages                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| Overview | Stats and conversion funnel                                                                 |
| Users    | Users (with activity timeline), Invite Codes, Roles, Permissions                            |
| Billing  | Payments, Subscriptions, Credits                                                            |
| Content  | Categories, Posts, Guest Posts, Tickets                                                     |
| Agent    | Agent accounts, tokens and audit log                                                        |
| Settings | General, Users, Auth, Payment, Email, Storage, AI, Analytics, Ads, Customer Service, Notify |

Provider credentials live in admin Settings (encrypted at rest when
`CONFIG_ENCRYPTION_KEY` is set), not in env files.

## Commands

| Command            | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `pnpm dev`         | Start Vite dev server (port 3000)                      |
| `pnpm build`       | Production build                                       |
| `pnpm start`       | Run the production server                              |
| `pnpm db:setup`    | Copy schema template for chosen database               |
| `pnpm db:push`     | Push schema to database (dev)                          |
| `pnpm db:generate` | Generate migration SQL (production)                    |
| `pnpm db:migrate`  | Run migrations (production)                            |
| `pnpm db:studio`   | Drizzle Studio GUI                                     |
| `pnpm rbac:init`   | Create roles + permissions + optional admin user       |
| `pnpm rbac:assign` | Assign role to user                                    |
| `pnpm admin:token` | Manage agent tokens; `sync-permissions` after upgrades |
| `pnpm cf:deploy`   | Build and deploy to Cloudflare Workers                 |

## Claude Code Skills

| Skill                | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `/quick-start`       | Build a complete SaaS from a brief or reference URL            |
| `/clone-website`     | Rebuild an existing website on this template                   |
| `/new-module`        | Create a backend module (service + API)                        |
| `/new-page`          | Create a dashboard page with API wiring + nav entry            |
| `/new-static-page`   | Create an MDX content page (legal, about, FAQ)                 |
| `/design-theme`      | Restyle the palette and fonts                                  |
| `/generate-image`    | AI-generate a decorative image for a page                      |
| `/security-scan`     | Check the diff for secrets and vulnerabilities before a commit |
| `/launch-audit`      | Responsive, theme, SEO, performance and security sweep         |
| `/deploy-cloudflare` | Deploy to Cloudflare Workers (D1 or Postgres + Hyperdrive)     |
| `/sync-upstream`     | Pull in the latest template changes                            |

Agent guidance lives in [AGENTS.md](./AGENTS.md); upgrade steps for existing
projects in [UPGRADING.md](./UPGRADING.md).

## Environment Variables

```env
# Required (public vars use the VITE_ prefix; secrets stay server-only)
VITE_APP_URL=http://localhost:3000
VITE_APP_NAME=My App
DATABASE_PROVIDER=sqlite        # sqlite | postgres | mysql | turso | d1
DATABASE_URL=file:data/local.db
AUTH_SECRET=generate-with-openssl-rand-base64-32

# Optional
VITE_APP_DESCRIPTION=
VITE_APP_LOGO=/logo.svg
VITE_DEFAULT_LOCALE=en
CONFIG_ENCRYPTION_KEY=          # encrypts secrets saved in admin Settings
```

See [.env.example](./.env.example) for the full list.

## License

This is proprietary software. See [LICENSE](./LICENSE) for the full license agreement.
