# SeeAPI settings installer

Add **Admin → Settings → AI → SeeAPI** to another project using this application's TanStack Start settings architecture. Includes Base URL, a masked API Key field, Save, and Test. Test sends only `GET https://api.seeapi.com/v1/credits` with Bearer authentication; it does not create a generation task.

## Install

Unzip this folder, then run with Node.js 20+:

```sh
node /path/to/seeapi-installer/install.mjs /path/to/your-project --dry-run
node /path/to/seeapi-installer/install.mjs /path/to/your-project
```

The installer checks compatibility before making changes, then backs up every affected file to `<project>/.seeapi-backup-<timestamp>-<id>/`. Shared configuration files are patched; they are not replaced by files from this project. Existing English messages and other platforms' settings remain in place. Running it again makes no further changes. If SeeAPI-owned files already differ, review them before choosing `--force`.

Requirements: the existing admin Settings page, `getSettingGroups`/`getSettings`, the settings test runner/specs, the encrypted/masked configuration service with `ENDPOINT_SECRETS`, and `src/core/db/atomic.ts`. Unsupported custom implementations fail before editing. This is an installer for compatible projects, not for arbitrary Next.js/Vue/Laravel applications.

After installation, run the project's normal checks and rebuild/restart:

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm dev
```

Open `/admin/settings`, select **AI**, and locate **SeeAPI**. Create a key in [SeeAPI API Keys](https://www.seeapi.com/keys/?tab=api-keys), paste it, then Save. Test supports unsaved values and reuses an unchanged masked saved key. Real keys must be entered separately for each project; this package includes no keys, environment files, databases, or account data.

## Storage and compatibility

- Settings: `seeapi_base_url` and `seeapi_api_key`, stored through the existing `saveConfigs` service. No new tables, dependencies, environment variables, or migration.
- The default Base URL is `https://api.seeapi.com`. A trailing `/v1` is accepted and normalized. Credentials are sent only to this official HTTPS origin, and redirects are rejected.
- Password values use the existing encryption mechanism when `CONFIG_ENCRYPTION_KEY` is configured. Browser/API reads return a masked value; public config never exposes the key.
- Existing settings read/write permissions, authentication, CSRF protection, rate limits and audit handling continue to apply. Changing a configured endpoint requires supplying the key again.
- Config writes use atomic upserts so a failed multi-field save rolls back on SQLite/D1 too. Concurrent first saves cannot create duplicate config rows.
- This module adds credential settings and a connection check. It does not install an image/video generation page, billing flow, or webhook receiver.

If the target has customized config write logic, integrate the two exported definitions from `src/config/seeapi.ts` into `getSettingGroups`/`getSettings`, register `seeApiTestSpec` and the runner's `seeapi` case, add the endpoint/key binding, call `normalizeSeeApiConfigs` before saving, and preserve atomic writes. The preflight refuses to replace custom write logic automatically.

## Restore

Use the backup path printed at installation:

```sh
node /path/to/seeapi-installer/install.mjs /path/to/your-project --restore /path/to/your-project/.seeapi-backup-TIMESTAMP-ID
```

Restore checks every file's hash first and refuses to overwrite edits made since installation. It restores original files and removes files created by this install. It does not delete saved credentials from the database; no database is changed by the installer or restore command.

## Maintainers

In the source project, run `node tools/seeapi-installer/sync.mjs` after editing the integration. Keep the original license included in this package. Official references: [Authentication](https://www.seeapi.com/docs/authentication/), [Getting Started](https://www.seeapi.com/docs/getting-started/).
