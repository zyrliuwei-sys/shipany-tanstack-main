# Upgrading an existing project

Read this when a project built from this template pulls newer template code.
Entries are newest first. Apply **every entry dated after the template version
the project last pulled**, oldest of those first.

## How to upgrade (every time)

1. **Find the baseline.** The last template commit the project took. Check
   `git log` for a `Template-sync:` trailer. If there isn't one, use the date of
   the last template pull.
2. **Bring the code over.** Merge or cherry-pick the template changes. When a
   file conflicts, keep the project's own changes, but re-apply the template's
   fixes inside it. Never keep the project's old copy of one service while
   taking the template's new copy of a service that depends on it, or the build
   breaks. Pairs that must move together are listed in each entry.
3. **Port the schema by hand.** `src/config/db/schema.ts` is the project's
   gitignored working copy, so pulling does not update it. Diff the template's
   `schema.<dialect>.ts` against the previous version and copy the new
   columns and tables into `schema.ts`.
4. **Apply the schema.**
   - Dev: `pnpm db:push`.
   - Production: `pnpm db:generate`, review the SQL, then `pnpm db:migrate`.
   - Cloudflare D1: re-run `/deploy-cloudflare`. Its Phase 4 generates and
     applies migrations.
5. **Register new permissions.** Run `pnpm admin:token sync-permissions`. It
   adds missing `admin.*` permission rows and never changes role assignments.
   Re-running `/deploy-cloudflare` does **not** do this, because it skips RBAC
   once roles exist. For remote D1, run the command against the local D1 copy
   and apply the `INSERT OR IGNORE` dump, the same way Phase 4.5 of that skill
   does. `super_admin` holds `*` and works without this step. You only need the
   new rows to grant new permissions to other roles.
6. **Install and verify.** Run `pnpm install`, `pnpm build`, and the
   `pnpm test:*` scripts. On Workers, also run `pnpm cf:build`.
7. **Record the sync.** End the upgrade commit with
   `Template-sync: <template sha>`.
8. **Hand over what code can't do.** Some items need the project owner:
   deployment env vars, running migrations on production, re-entering
   secrets. List every such unchecked item to the user when the upgrade is
   done, with the exact value to set (e.g. `PLAUSIBLE_SCRIPT_HOSTS=stats.example.com`,
   taken from the project's own settings), not just a link to this file.

When you change the template itself, add an entry here for anything an
existing project must act on. That covers schema, env vars, renamed or removed
exports, permission codes, and behavior that changes for end users.

---

## 2026-11-13: Remove upstream product branding and demo articles

Public/default copy now uses neutral account/workspace wording and the
configured application name (fallback `My App`). The two bundled template
blog articles, their sitemap entries, the optional upstream footer badge,
generator metadata and identifying response header are removed. Default
icons are neutral geometric marks. Existing database articles are not part
of the bundled demo content; review any locally authored vendor content
separately when upgrading. The original license remains in `LICENSE`.

`SiteFooter` no longer accepts the `builtWith` prop. Remove that prop from
custom footer integrations. The local blog registry starts empty; register
your own MDX posts when adding content. Root/sidebar/footer/email branding
continues to use `VITE_APP_NAME`; configure the product name before deployment.

The downloadable admin instructions and MCP server display name are now
`site-admin`. The client accepts `SITE_ADMIN_URL`, `SITE_ADMIN_TOKEN`,
`SITE_ADMIN_PROJECT` and `SITE_ADMIN_CONFIG`, and new default stores use
`~/.site-admin/projects.json`. Legacy environment names and saved credentials
remain readable. No account keys, permissions, sandbox bridge protocol or
secret-placeholder validation is changed. Update the bundled client and
instructions together, rebuild and redeploy. Run `pnpm test:copy` and the
admin integration tests.

## 2026-11-13: English-only product

Only `en` is enabled in `project.inlang/settings.json`. Chinese catalogs and
Chinese MDX pages/posts are removed. Public and dashboard language selectors
hide automatically with a single enabled locale. Locale cookies no longer
choose the language, so an existing `PARAGLIDE_LOCALE=zh` cookie cannot bring
the removed edition back. Generated metadata and sitemap entries contain
only English.

Take the locale configuration, Vite configuration, server entry,
`src/lib/english-only.ts`, redirect helpers, UI changes and content removals
together. The server permanently redirects `/zh` and `/zh/*` to their
English equivalents, preserving query strings. Auth return URLs also drop
the retired prefix safely. Rebuild to regenerate Paraglide, then redeploy.

Bot notification templates are English-only as well. Existing
`notify_language=zh` settings are ignored; no database migration is needed.
The IndexNow installer now ships/synchronizes only the English catalog.
New product copy belongs only in `messages/en.json`; do not recreate a
second catalog when following older generic skill examples.

## 2026-11-12: Portable Plausible trust and IndexNow installer repairs

New projects trust `stats.cadcraft.org` as a Plausible script host through
`src/config/analytics.ts`, alongside `plausible.io`. This explicit repository
configuration travels with the template; a developer's ignored
`.env.development` did not. Other script hosts still require the deployment
environment allow-list, and HTTP, credentials and lookalike hosts remain
rejected. Take the config, embed validation and settings help text together,
then rebuild/redeploy existing projects to use this new default.

IndexNow is already built in. Its key is read/written directly through its
own module, bypassing neither permissions nor the public verification route.
The older standalone installer wrote `indexnow_key` through `saveConfigs`,
which newer templates deliberately refuse; it could report success without
actually saving the key. The repaired bundle is maintained under
`tools/indexnow-installer` and can upgrade an older installation with
`node tools/indexnow-installer/install.mjs /path/to/project --force`.
It backs up changed files, preserves unified admin operations where present,
and uses dedicated permissions on older templates. Legacy encrypted key
rows remain readable while the original `CONFIG_ENCRYPTION_KEY` is present.
The status endpoint returns its permitted actions so older permission-summary
APIs without individual codes still work; every action remains server-checked.

The server's runtime `VITE_APP_URL` (Workers binding first) now determines
IndexNow's host/keyLocation, sitemap entries and robots' sitemap URL, instead
of a stale build-time localhost value. Take `src/lib/site-origin.ts` together
with the IndexNow service, sitemap and robots routes. Keep `VITE_APP_URL`
set to the actual public site in the deployment environment. Local/private
origins still cannot submit externally. Key-file verification must pass
before the UI enables submission, and a mismatched admin origin is reported.

No new tables or permission codes are required. Existing projects need to
deploy the updated files; changing this template does not update their
running deployments. Run `pnpm test:indexnow`, the admin/guard tests and
`pnpm build`. `tsconfig.json` excludes the installer's TypeScript payload
from the host project's compilation; those files compile in their target
project after installation.

## 2026-11-02: First-party operations dashboard

`/admin/operations` adds same-time today/yesterday comparisons (UTC+08:00),
per-currency net revenue, unpaid checkout users, AI health, first-touch
visitor cohorts by channel/country/entry/build, daily reports, CSV export,
and an experiment journal. The shared admin operations also expose these
reports and logs to authenticated agents; no external analytics service is
required. The journal does not allocate A/B traffic or change prices.

### Action required

- [ ] Copy `analyticsVisitor` and `operationsExperiment` from the matching
      schema template into `schema.ts`. For development run `pnpm db:push`;
      for production generate and review migrations before applying them.
- [ ] Run `pnpm admin:token sync-permissions` to register
      `admin.operations.read` and `admin.operations.write`. Existing super
      administrators work immediately. Grant the explicit codes to other
      roles as needed; the command preserves current role assignments.
- [ ] Take the operations tracker, root integration, auth signup hook,
      signed-cookie helper, build configuration, module, admin operations,
      routes, blocks and translations together. Visits start being collected
      after installation. Historical anonymous visits cannot be reconstructed.
- [ ] Visitor collection honors cookie consent, DNT and GPC. Entry pages
      exclude queries; no IP addresses or raw referrers are stored in the
      new table. First-touch cohorts remain fixed across return visits.
      Authenticated users are deduplicated to the earliest linked browser;
      staff with active admin-access roles, API accounts and marked test
      browsers are excluded. Mark a fresh test browser's first public visit
      with `?ops_test=1` to exclude it.
- [ ] Builds embed the current Git revision. Optionally set `VITE_BUILD_ID`
      in CI for a release label (maximum 191 characters). Cohort revenue
      excludes renewals; daily totals include them. Recorded refunds revise
      the original payment day. Each currency stays separate.
- [ ] Run `pnpm test:operations` and `pnpm build`. Provider-balance estimates,
      automatic A/B traffic and scheduled reports require product-specific
      integrations and are not enabled by the journal.

## 2026-10-31: IndexNow administration

The admin sidebar now includes `/admin/indexnow`: save an ownership key,
verify `/{key}.txt`, and submit sitemap URLs or specific changed pages.
The existing `config` table stores `indexnow_key`; no schema migration or
additional package is needed. This public verification token is managed by
IndexNow, excluded from general/custom settings, and read without caching.

### Action required

- [ ] Run `pnpm admin:token sync-permissions` to register
      `admin.indexnow.read`, `admin.indexnow.write`, and
      `admin.indexnow.submit`. Super admins already have access. Grant the
      explicit codes to other roles as needed; ordinary admin seeds grant
      read and submit, while key changes require a separate write grant.
- [ ] Set `VITE_APP_URL` to the public site's origin before deploying and
      save your IndexNow key on the new page. Local preview supports saving
      and checking the key file; external submission is disabled for local
      origins. Each request accepts at most 10,000 same-host URLs.
- [ ] Submission acceptance (HTTP 200/202) is not a guarantee of indexing.

## 2026-10-31: Install administrator-managed footer badges

Super administrators can manage HTTPS badge links at `/admin/footer-badges`.
Badges are stored under `footer_badges` in the existing `config` table;
no schema change or database migration is required. The generic settings
and custom settings APIs cannot overwrite or remove this module-owned key.

Take the footer-badges feature, module, admin handlers/operations, routes,
translations, root loader, public config, user permissions endpoint, footer
block/component, and marquee CSS together. Custom footers can render badges
through the new optional `SiteFooter.badges` slot. Keep the root loader
integration so badges appear in server-rendered HTML for backlink verification.

The new `admin.footer-badges.read` and `admin.footer-badges.write` operations
also require the global `*` permission; ordinary administrator wildcards
cannot grant access. Existing super administrators work without re-seeding.
No badges appear until one is added in the admin page.

## 2026-10-31: Hide the footer attribution by default

`SiteFooter` no longer displays the "Built with ShipAny" badge by default.
No action is required to hide it. Projects that want to display it can pass
`builtWith="pill"` or `builtWith="text"` explicitly.

## 2026-10-31: Load the translation plugin locally

The message-format plugin is now an installed development dependency instead
of a jsDelivr download at dev/build time. An unavailable CDN could previously
produce an empty message module and crash pages with errors such as
`m.landing.nav.features is not a function`.

### Action required

- [ ] Take `package.json`, `pnpm-lock.yaml`, and
      `project.inlang/settings.json` together, run `pnpm install`, and restart
      `pnpm dev` to regenerate `src/paraglide/`. Translation keys and locale
      URLs are unchanged.

## 2026-10-28: Dependency security upgrade

`pnpm audit` went from 189 advisories (8 critical, 78 high) to 2 (one
moderate in `drizzle-kit`'s bundled esbuild, dev-only; one low in
`deepmerge`, no fix published). Notable: TanStack Start (reflected XSS),
drizzle-orm 0.45 (SQL injection via identifiers), vite, undici, ws, postcss,
zod, markdown-it, tiptap/prosemirror (paste XSS). Major versions were not
taken (stripe, resend, lucide-react, motion, TypeScript, react-table).

### Action required

- [ ] **Lockfile**: take `package.json` and `pnpm-lock.yaml`, run
      `pnpm install`, then `pnpm audit`.
- [ ] **`next` override**: `pnpm.overrides.next = "-"` stops pnpm from
      installing Next.js as better-auth's optional peer (it carried most
      of the critical advisories and is never used here). Keep it.
- [ ] **Server functions**: TanStack Start renamed `.inputValidator()` back
      to `.validator()` on `createServerFn`. The old name is gone at runtime
      too (the build still passes, the call throws), so search your own code
      for `inputValidator` and rename it.
- [ ] **Docker**: rebuild with `docker build --pull` so `node:22-alpine`
      picks up the latest Node 22 security release.

## 2026-10-28: Subscription renewals could skip credits (fix)

Since the 2026-10-11 renewal hardening, a renewal was treated as "already
handled" whenever the subscription's stored period had already moved forward.
Stripe sends `customer.subscription.updated` (new period) and
`invoice.payment_succeeded` (the payment) together, and the update usually
arrives first. When it did, the payment was dropped silently: the user was
charged, but no renewal order and no credits were created. Creem and PayPal
went through the same path.

Renewals are now claimed by a renewal order number derived from the period
(`<subscriptionNo>-<periodStartMs>`, unique), so event order no longer
matters. Subscription updates only move the period forward.

### Action required

- [ ] **Merge**: take `handleSubscriptionRenewal` and
      `handleSubscriptionUpdated` in `src/modules/payment/service.ts` together,
      plus `tests/payment-idempotency.test.ts`. No schema change.
- [ ] **Find missed renewals** if the project ran the 2026-10-11 code with
      recurring plans. Compare the provider's paid renewal invoices (Stripe:
      `billing_reason = subscription_cycle`) since then with
      `order` rows where `payment_type = 'renew'`. Grant the missing credits
      by hand from the admin, and contact the affected users.
- [ ] **Custom renewal code**: if you look up renewal orders by `order_no`
      format, note the new format above. Older renewals keep their snowflake
      numbers.

## 2026-10-17: Guest posts (off by default)

Outside authors can submit paid articles: they write at
`/settings/guest-posts` and pay to submit, an admin reviews at
`/admin/guest-posts`, and an approved article is published to the blog with
a Sponsored label and `rel="sponsored nofollow"` links. Rejecting refunds the
author in full; a refund from the Payments page has the same effect.
`/guest-post` explains it publicly. It stays off until an admin turns on
Settings → Users → Guest Posts → Accept guest posts.

A paid submission or a free resubmission sends a bot message through the
admin Notify settings (on by default; switch Notify → Guest posts off
to stop it). No emails are sent: authors follow the review result at
`/settings/guest-posts`. Admins can also take a published post down and
later republish it or send it back for changes.

### Action required

- [ ] **Schema**: one new table, `guest_post`, and one new nullable column,
      `order.reference` (what an order buys beyond its product, e.g.
      `guest_post:<id>`). Port both into `schema.ts` from the template for
      your dialect and apply them (steps 3–4).
- [ ] **Permissions**: run step 5 to register `admin.guest-posts.read`,
      `admin.guest-posts.review` and `admin.guest-posts.reject`. New seeds give
      read/review to `admin` and `editor`; reject refunds money, so only
      `super_admin` (`*`) has it until you grant it explicitly. Existing roles
      need them granted by hand.
- [ ] **Pricing**: `src/config/pricing.ts` gains two guest post packages
      (`kind: 'guest_post'`). Adjust their prices or remove them. If you use
      Creem, map them in `creem_product_ids_mapping`.
- [ ] **Merge pairs**: `modules/payment/service.ts` now calls
      `modules/guest-posts/service.ts`; take both together. The generic
      checkout's price logic moved to `src/server/payment/charge.ts`.
- [ ] **Blog**: `/blog/<slug>` now serves only `article` and `guest` posts.
      A published `page` or `log` post is no longer reachable there.
- [ ] **Bot notifications**: payment, ticket and guest post messages now start
      with the site name (`【<App Name>】Stripe 收款成功`) instead of a
      `产品：/Product:` line. Webhook `data.app_name` is unchanged; update any
      automation that matched the old message text.
- [ ] **Customized posts admin**: `/api/admin/posts` hides and refuses
      `guest` posts; keep that check if you merge it by hand.
- [ ] **Custom checkout callers**: `/api/payment/checkout` (and the guest
      post checkout) now take an optional `locale` and send the buyer back to
      that locale's success/cancel page. Pass `getLocale()` if you call them
      from your own UI; without it the buyer lands on the default locale.

---

## 2026-10-17: Users settings tab; user-center pages can be switched off

Admin Settings has a new **Users** tab after General. Signup credits, default
role and a new **User Features** group moved there, as did the Guest Posts
settings (the Guest Posts tab is gone). User Features switches the optional
user-center pages, defined in `src/config/user-features.ts`. A page that is
off disappears from the sidebar and the overview, and opening it sends the
user to the overview:

- **Credits** (`credits_enabled`), **Billing** (`billing_enabled`) and
  **Payments** (`payments_enabled`), on by default. Their read-only APIs keep
  working (the balance is shown elsewhere too). With Billing off, users
  can't cancel a subscription themselves.
- **API keys** (`apikeys_enabled`), **off** by default. `/api/apikeys` also
  refuses to list, create or delete keys while it is off. Existing keys stay
  in the database.
- **Support tickets** (`tickets_enabled`), on by default. While off, the
  floating support button disappears too and the user `/api/tickets` routes
  refuse. Admins still see existing tickets.

### Action required

- [ ] **Projects whose users use API keys**: turn the API keys switch on, or
      users lose the page after the upgrade.
- [ ] **Your own routes that call `validate()` from
      `@/modules/apikeys/service`**: it doesn't check the switch. If keys
      should stop working while it is off, add
      `if (!(await userFeatureEnabled('apikeys_enabled')))` from
      `@/server/user-features` to that route.

No schema or permission changes.

---

## 2026-10-17: Per-project session cookies in dev

Browsers share cookies across ports, so several projects running `pnpm dev`
on `localhost` overwrote each other's `better-auth.*` session cookie, and a
reload in one project signed you out of all of them. In dev the cookie prefix
now comes from `AUTH_COOKIE_PREFIX`, or else a slug of `VITE_APP_NAME` (e.g.
`My App` → `my-app.session_token`). Production keeps `better-auth` unless
`AUTH_COOKIE_PREFIX` is set, so deployed users stay signed in.

### Action required

- [ ] **Code that reads `better-auth.session_token` directly**: build the name
      from `getAuthCookiePrefix()` (`@/core/auth`) instead, as
      `src/routes/api/auth/token.ts` does. Otherwise it breaks in dev.
- [ ] **Several local projects with the same `VITE_APP_NAME`**: give each a
      different `AUTH_COOKIE_PREFIX` in `.env.development`.

Local dev sessions sign out once after the upgrade. No schema, permission or
production changes.

---

## 2026-10-17: ShipAny attribution markers

- Every response now carries `X-Powered-By: ShipAny`, and every page has
  `<meta name="generator" content="ShipAny">`. Both identify the stack, much
  like WordPress's generator tag.
- The footer's "Built with ShipAny" badge inherits the surrounding text
  color, and `SiteFooter` takes `builtWith="pill" | "text"`.
- `LICENSE` clarifies that the "Built with ShipAny" link is optional: keep,
  restyle, move or remove it. Only copyright notices in the source code must
  stay.

### Action required

- [ ] **Customized `src/server.ts` / `__root.tsx` / `site-footer.tsx`**:
      merge the template changes (`withPoweredBy` in the server entry, the
      generator meta, the `builtWith` prop).

---

## 2026-10-17: Appearance settings (off by default)

Admin Settings → General → Appearance gets a master switch, **Enable
appearance settings** (`appearance_enabled`). It is **off by default**, and
while off the site renders exactly from code: the `:root`/`.dark` palette in
`globals.css`, the fonts there, `DEFAULT_APPEARANCE` for the sidebar, light/dark
per visitor, and `<Toaster richColors>`. No `data-theme` attribute or inline
style is put on `<html>`.

Turned on, the admin picks:

- **Light / dark** (`app_color_mode`): the default for visitors who haven't
  picked one. With "Let users pick their own theme color" off, Light or Dark
  is forced on everyone and the toggles are hidden.
- **Site theme** (Classic, Forest, Ocean, Violet, Sunset, Rose, Slate): this
  replaces the code palette (Classic is a layered neutral, not your
  `:root`). The colored themes paint the dashboard sidebar and tint the main
  area.
- **Font** (Inter, System, Rounded, Serif). Self-hosted, OFL-licensed.
- **Font size** (Small, Medium, Large): scales rem, like browser zoom.
- **Sidebar style** (Inset, Floating, Classic = shadcn `variant`) and
  **collapse** (hide completely, or collapse to icons = shadcn `collapsible`).
- **Let users pick their own theme color** (`user_theme_enabled`): adds a
  theme color picker to the user menu (cookie `app_theme`). Users can change
  nothing else.

Appearance fields save on click. Presets live in `src/config/appearance.ts`.

### Action required

- [ ] **Install**: `pnpm install` (adds `@fontsource-variable/nunito` and
      `@fontsource-variable/source-serif-4`).
- [ ] **`src/styles/globals.css`**: the template only _adds_ a "Color themes"
      block and a toast block; `:root`/`.dark` are unchanged. Keep your
      palette and copy those two blocks in.
- [ ] **Dashboard sidebar header** (always on, not behind the switch): the
      brand row is now as tall as the content header, so it lines up with the
      sidebar toggle. It also shows the `VITE_APP_LOGO` image (default
      `/logo.svg`) when that URL loads. Check that your logo looks right
      there. The template's `.env.example` used to point at a missing
      `/logo.png`; fix it in your env files if you copied that.
- [ ] **`<html data-theme>`**: if your project (or a library such as
      daisyUI) already uses `data-theme` on `<html>`, keep the switch off or
      rename one of them.
- [ ] **Customized `__root.tsx`**: keep the template's `ThemeProvider`
      `defaultTheme`/`forcedTheme` and `Toaster richColors` expressions. If you
      had hard-coded `defaultTheme="dark"`, set `DEFAULT_COLOR_MODE = 'dark'`
      in `src/config/appearance.ts` instead.
- [ ] **Customized `app-sidebar.tsx` / `app-layout.tsx` / `user-menu.tsx`**:
      merge the new props (`variant`, `collapsible`, `logo`), and keep sidebar
      text on `sidebar-foreground` tokens so it stays readable on a colored
      sidebar.

No schema, env or permission changes.

---

## 2026-10-12: Activity timeline, product events, admin password reset

### Action required

- [ ] **Schema**: one new table, `user_event` (product events). Port it into
      `schema.ts` from the template for your dialect and apply it (steps 3–4).
      Nothing existing changes.
- [ ] **Permissions**: run step 5 to register `admin.passwords.reset`.
- [ ] **Self-hosted Plausible** (only if admin Settings → Analytics → Plausible
      script URL is a full URL on a host other than `plausible.io`): set the
      server env var `PLAUSIBLE_SCRIPT_HOSTS` to that host, e.g.
      `PLAUSIBLE_SCRIPT_HOSTS=stats.example.com`. On Workers put it in
      wrangler `vars`; on Docker/Node in the container or server env. A
      restart or redeploy is enough. Until it is set, the script does not load
      and saving that URL is refused. This replaces the build-time
      `VITE_PLAUSIBLE_SCRIPT_HOSTS` from 2026-10-11, which still works.
      Same-site proxy paths like `/js/script.js` need nothing.

### New, no action needed

- **Settings save** only validates fields that changed, so a stored
  Plausible URL that no longer passes no longer blocks saving the rest of
  the tab (e.g. the Google Analytics ID). The save error names the host to
  add.

- **Product events**: register kinds in `src/config/events.ts`. Record them
  with `recordEvent()` (`@/modules/events/service`) on the server, or with
  `track()` (`@/lib/track`) from the browser for kinds marked
  `client: true`. Browser reports go through `POST /api/events`, which is
  signed-in only, same-origin only, rate-limited, and capped to a small flat
  detail. `PricingTable` reports `plan_selected`. See AGENTS.md → "Product
  events".
- **Custom timeline sources**: `src/server/admin/timeline-sources.ts` plugs
  rows from the project's own tables into the timeline.
- User detail page: an "Activity" timeline (`users_timeline`,
  `GET /api/admin/users/timeline?userId=`, `users.read`). Built-in events
  come from existing tables, so existing history shows up right away: sign-up,
  orders created, paid, closed and refunded, subscriptions, credit grants and
  charges, AI tasks and tickets. It shows oldest first by default, with a
  toggle. Each row opens its record. The subscriptions and credits admin pages
  now accept `?search=`.
- Admin users list: "Set password" in the row menu
  (`users_set_password`, `POST /api/admin/users/password`). It needs the
  dedicated `admin.passwords.reset` code, which sits outside `admin.users.*`
  so the `admin` role does not pick it up; only `super_admin` has it unless you
  grant it (run step 5 to register the row). It signs the user out everywhere,
  adds an email/password login for OAuth-only users, refuses agent API keys,
  and refuses users whose roles exceed the caller's permissions. The row menu
  is also wider so labels no longer wrap.

---

## 2026-10-11: Atomic writes on D1, payment hardening, Agent API

### Action required

- [ ] **Schema** (additive only, nothing is dropped). Port these into
      `schema.ts`, then apply them (steps 3–4):
  - `user.type`: text, not null, default `'user'`. Agent accounts use `'api'`.
  - `apikey.type`: text, not null, default `'user'`. Agent keys use `'admin'`.
  - `apikey.expires_at`: nullable timestamp_ms. Null means the key never expires.
  - `order.refund_amount`, `order.refunded_at`, `order.refund_result`.
  - The new table `admin_execution`.
  - The `utm_*`, `referrer` and `country` columns on `user`, if the project
    predates them.
- [ ] **Alipay / WeChat Pay**: every product sold through them needs
      `cnyPriceInCents` in `src/config/pricing.ts`. Without it those providers
      now refuse the product. Previously a USD price was silently charged as CNY.
- [ ] **Dependencies**: run `pnpm install`. better-auth is now `^1.7.7`, and
      `seroval`/`seroval-plugins` are pinned to `1.6.8` through pnpm overrides.
- [ ] **Permissions**: run step 5. New codes include `admin.payments.refund`
      and the analytics and agent operations.
- [ ] **Self-hosted Plausible**: superseded by the 2026-10-12 entry (runtime
      `PLAUSIBLE_SCRIPT_HOSTS`, no rebuild). Old text kept for reference: if
      `plausible_src` is a full URL on a host
      other than `plausible.io` (e.g. `https://stats.example.com/js/script.js`),
      add that host to `VITE_PLAUSIBLE_SCRIPT_HOSTS` (comma-separated, exact
      hostnames) and **rebuild**. It is a `VITE_` var, so it is baked into the
      client bundle: put it in `.env.production` or the build environment.
      Setting it only at runtime (or only in wrangler `vars`) does not work.
      Without it the script silently stops loading; the stored setting is kept
      and works again once the host is listed. Also switch any `http://` URL to
      `https://`. Same-site proxy paths such as `/js/script.js` keep working
      with no change.
- [ ] **Initial role**: if `initial_role_name` in admin settings points at a
      role that grants admin access, point it at a non-admin role. Otherwise new
      signups get no role (see "Behavior changes").
- [ ] **Optional data repair (D1 deployments only).** Before this change, a
      write that failed halfway on D1 could leave an order marked paid with no
      credits. Find such orders:
  ```sql
  SELECT o.order_no, o.user_id, o.credits_amount FROM "order" o
  WHERE o.status = 'paid' AND o.credits_amount > 0
    AND NOT EXISTS (SELECT 1 FROM credit c
      WHERE c.order_no = o.order_no AND c.transaction_type = 'grant');
  ```
  Grant the missing credits from the admin console after checking each one.

### Breaking code changes (only if the project calls these directly)

- `deductForRefund(...)` was replaced by `planDeductForRefund(...)`, which
  returns `{ deducted, steps }`. Run the steps with `atomic()`.
- `consume(...)` no longer accepts `tx`. To charge credits together with your
  own writes, use `planConsume(...)` and put its `steps(q)` into the same
  `atomic()` call. `src/modules/ai-tasks/service.ts` shows how.
- `enforceMinIntervalRateLimit` no longer reads cookies. Passing `extraKey`
  now keys the limit to that value, the user id, **instead of** the IP.
- **Move these together:** `src/core/db/atomic.ts`,
  `src/modules/credits/service.ts`, `src/modules/payment/service.ts` and
  `src/modules/ai-tasks/service.ts`.

### Behavior changes users may notice

- **OAuth linking**: signing in with Google or GitHub no longer attaches to an
  existing password account whose email was never verified. This closes the
  pre-registration account takeover.
- **Endpoint secrets**: changing `openai_base_url`, `anthropic_base_url` or
  `r2_endpoint`, `telegram_api_base` or `notify_webhook_url` in settings now
  requires re-entering the matching secret.
- **Uploads**: at most 10 files and 20 MB per request, 10 MB per file. Only
  jpg/png/webp/gif/avif/heic are accepted. SVG is refused because it can carry
  script, and the stored extension comes from the MIME type, never the filename.
- **Rate limits**: requests are now limited per IP, and per user once signed in.
- **Initial role**: a role that grants admin access (`*`, `admin.*`) can't be
  set as `initial_role_name`, and signup also re-checks it. If an existing
  project already points `initial_role_name` at such a role, new users now get
  no role at all (an error is logged). Point it at a non-admin role.
- **Payment test amount**: `<provider>_test_amount` now applies only to users
  with `admin.access`. Everyone else pays the catalog price.
- **Credits**: `consume` rejects amounts that aren't positive integers, and
  fails with "insufficient credits" instead of under-deducting when the
  balance runs out mid-way.
- **Refunds**: refunding requires `admin.payments.refund`. Only `super_admin`
  holds it by default; the `admin` role no longer picks it up through
  `admin.payments.*`.
- **Admin order edit**: the status can only go from an unpaid order
  (`created`/`pending`) to `failed`. Paid, refunding and refunded states change
  only through checkout and refunds. Before this, moving a paid order back to
  pending let the next payment notification grant its credits again.
- **Checkout settlement** additionally requires `paid_at` to be empty and no
  existing grant for the order. New grants use `transaction_no =
grant_<orderNo>`, so the unique index allows one grant per order. Older
  rows keep their numeric transaction numbers.
- **Alipay / WeChat**: notifications are checked against the configured
  `app_id` / `mchid` and the order amount. Mismatches are rejected.
- **Embed IDs are validated**: `google_analytics_id`, `adsense_code`,
  `crisp_website_id`, `tawk_property_id`, `tawk_widget_id` must match their
  provider's format (see `src/lib/embed-ids.ts`), and `plausible_src` must be
  a same-site path or an https URL on `plausible.io` or on a host listed in
  the deployment env `PLAUSIBLE_SCRIPT_HOSTS` (since 2026-10-12; previously
  the build-time `VITE_PLAUSIBLE_SCRIPT_HOSTS`). Bad values are refused on save. Values already stored in the
  database that don't match are no longer rendered, so check these settings
  after upgrading.
- **Checkout return page**: after a successful payment the user now lands on
  `/settings/payments` by default (pricing block, `PricingTable`, and the
  checkout/callback fallbacks). If the project pointed it somewhere else on
  purpose, keep its own `callbackUrl`.
- **Admin search**: the search boxes on users, payments, subscriptions, credits,
  tickets and invite codes are case-insensitive on every database. They also
  match the account's email and name, and an exact user ID. Subscription search
  used to be ignored by the API; it now filters.

### New, no action needed

- `atomic()` / `guard()` in `src/core/db/atomic.ts`. See AGENTS.md
  → "Atomic writes".
- Admin Agent API (`/admin/agent`), the conversion funnel, overview KPIs and the
  `analytics_report` operation. See `docs/admin-agent.md`.
- `src/lib/sql-search.ts` for admin list search.
- `src/components/user-cell.tsx` (`UserCell`): avatar + name + email that
  links to `/admin/users/$id`. Payments, subscriptions, credits and tickets
  open it in a new tab.
- Admin users list: ID column with copy, effective roles column, and a
  `utm_source` filter (`users_sources` operation, `GET /api/admin/users/sources`,
  `users.read`). The subscriptions and credits list APIs now also return
  `userName` / `userImage`.
