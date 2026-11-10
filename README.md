# KOReader Cloud Sync

A small, private KOSync server (KOReader's **Progress sync**) that runs on a Cloudflare Worker with a D1 database, entirely on the **Workers Free plan**. It syncs reading positions between your devices. Statistics sync is not involved.

- One Worker, one D1 database, one or two secrets. No other Cloudflare products.
- Passes the [kosync-conformance](https://github.com/pid1/kosync-conformance) verifier.
- Never stores or logs book titles, authors or file names. Logging is off by default.
- You choose who can create accounts: nobody (script only), an allowlist, or anyone (see [Registration](#registration)).

## Why use this?

KOReader's official sync server has had stability issues in recent months. There are good third-party servers, but using one means trusting someone else with your reading history and their uptime.

This project lets you run your own instead:

- **Your data, your account.** Reading positions live in a database in your own Cloudflare account. Nothing goes to a third party, and you can back it up, restore it or delete it whenever you like.
- **Free and always on.** It runs on Cloudflare's free Workers plan, on their global network, with nothing to keep running at home: no server, NAS or VPS. If a free-plan limit is ever reached, requests pause until midnight UTC; you are never billed.
- **Very little setup.** One Worker, one database, one required secret. A first deploy takes about ten minutes with the steps below, and KOReader just needs your URL as a custom sync server.

### Credits

- [KOReader](https://github.com/koreader/koreader) and the reference [koreader-sync-server](https://github.com/koreader/koreader-sync-server), whose behaviour defines the protocol.
- [kosync-conformance](https://github.com/pid1/kosync-conformance) by pid1: the protocol description this server is built from, and the verifier it's tested against (fetched at test time, not bundled).
- [nperez0111/koreader-sync](https://github.com/nperez0111/koreader-sync), an earlier KOSync server for Cloudflare Workers that inspired this one. This is a separate implementation, not a port.

Co-developed with Claude Opus 5.5 (Anthropic).

Also in this repo: `SPEC.md` (the wire protocol and this server's implementation choices) and `CLAUDE.md` (instructions for AI coding agents working on the code).

## Requirements

- A Cloudflare account. The free Workers plan is all you need: don't subscribe to Workers Paid, and don't enable add-ons such as R2 or Logpush for this project.
- Node.js 20+ and npm.
- On Windows, run interactive `wrangler` commands (anything that prompts you, such as `wrangler secret put`) in **CMD or PowerShell**, not Git Bash. Git Bash can fail silently there. Check with `npx wrangler secret list`.

## First deploy

1. Clone and install:
   ```sh
   npm install
   npx wrangler login
   ```
2. Create your database and replace the all-zeros placeholder in `wrangler.jsonc` (`d1_databases[0].database_id`) with the id it prints. The placeholder is fine for local development but won't deploy.
   ```sh
   npx wrangler d1 create kosync --location weur      # pick the location hint nearest you
   ```
3. Choose a registration mode: set `vars.REGISTRATION` in `wrangler.jsonc` to `"off"`, `"allowlist"` or `"open"`. Read [Registration](#registration) first. If unsure, use `"off"`.
4. Create the pepper, a random server-side secret mixed into every stored password hash. Save it in your password manager: you need it again to create accounts with the script.
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   npx wrangler secret put AUTH_PEPPER                 # paste it at the prompt
   npx wrangler secret list                            # must list AUTH_PEPPER
   ```
5. Create the tables and deploy:
   ```sh
   npm run db:migrate:remote
   npm run deploy                                      # prints https://kosync.<your-subdomain>.workers.dev
   curl https://kosync.<your-subdomain>.workers.dev/healthcheck   # {"state":"OK"}
   ```

If every logged-in request returns `500 {"code":2000,...}`, the Worker can't see `AUTH_PEPPER`: re-run step 4.

## Registration

KOReader's Progress sync screen has **Register** and **Login** buttons. `REGISTRATION` in `wrangler.jsonc` decides what Register does. It's read at deploy time, so run `npm run deploy` after changing it. Change it in the file, not in the Cloudflare dashboard. Dashboard edits to plain variables are overwritten by the next deploy, and adding one there can drop `REGISTRATION` from the live version (see the warning below).

| Mode | Who can create an account | Good for | Risks you accept |
|---|---|---|---|
| `"off"` (default; also used if the value is missing or misspelled) | Only you, with `npm run user:add` from a terminal | Maximum safety | None beyond the basics |
| `"allowlist"` | Usernames you list in the `ALLOWED_NEW_USERS` secret | Households and friends, without needing a terminal per person | A listed name goes to whoever registers it first; people pick their own passwords |
| `"open"` | **Anyone** who knows or finds your URL | Public or community servers | Strangers can create accounts and store data; weak passwords can be guessed |

In every mode, Register on an existing name fails ("Username is already registered"), so registering can't take over an account. `npm run user:add` works in every mode for rotating, disabling and deleting accounts.

### Why the modes differ in safety

- **Passwords.** `npm run user:add` generates a random ~99-bit password, which can't be guessed. With Register, people type their own password on the e-reader. KOReader sends only its MD5, so the server **cannot check how strong it is**. There's no rate limiting, so a weak password can be guessed (an attacker's only limit is the free plan's 100k requests a day). Tell everyone who registers to use a long password from a password manager.
- **Your URL isn't secret.** `*.workers.dev` hostnames appear in certificate-transparency logs and get scanned. In `"open"` mode, assume strangers will find it.
- **Free-plan limits.** In `"open"` mode, a flood of sign-ups uses up your daily write limit. Sync then stops for everyone until 00:00 UTC, but nothing is ever billed.
- **Allowlist failures look like "off".** A name that isn't on the list gets the same "registration is disabled" answer, so a stranger can't tell your server is in allowlist mode.

### Using the allowlist (step by step)

1. In `wrangler.jsonc`, set `"vars": { "REGISTRATION": "allowlist" }` and run `npm run deploy`. Until you add the secret, nobody can register.
2. Add the names that may register: letters, digits, `.`, `_` or `-` (up to 64 characters), separated by commas. Names are case-sensitive. **Either**
   - **Dashboard (no terminal):** Workers & Pages → `kosync` → Settings → Variables and Secrets → Add → Type **Secret**, Name `ALLOWED_NEW_USERS`, Value `alice,bob` → Deploy. **or**
   - **Terminal:** `npx wrangler secret put ALLOWED_NEW_USERS`, then type `alice,bob` (CMD/PowerShell on Windows). In any shell, including Git Bash, this works without a prompt: `printf '%s' 'alice,bob' | npx wrangler secret put ALLOWED_NEW_USERS`.

   Secrets take effect immediately and survive later deploys.

   > ⚠️ **The Type must be Secret, not Text.** Adding a *Text* variable in the dashboard creates a new live version that keeps only the dashboard's variables. It drops `REGISTRATION` from `wrangler.jsonc`, so the server falls back to `"off"` and every Register says "registration is disabled". If that happens, delete the Text variable, run `npm run deploy`, then add the list as a Secret. Check with `npx wrangler secret list` (it must show `ALLOWED_NEW_USERS`).
3. On each person's device: Progress sync → Custom sync server → your URL → **Register**, with their username and a strong password.
4. Afterwards, take the name off the list, or delete the secret when everyone has registered (Dashboard → same page → delete; or `npx wrangler secret delete ALLOWED_NEW_USERS`). Leaving a name listed changes nothing once its account exists, but removing it keeps the list honest.

To lock everything down again, set `REGISTRATION` back to `"off"` and deploy. Existing accounts keep working.

## Accounts with the script

Works in every mode. You need the production pepper in your shell, without it showing on screen or in your history:

```sh
read -rs AUTH_PEPPER && export AUTH_PEPPER          # bash/zsh; PowerShell 7: $env:AUTH_PEPPER = Read-Host -MaskInput
npm run user:add -- alice --remote                  # create; prints a generated password once
npm run user:add -- alice --remote --rotate         # new password
npm run user:add -- alice --remote --disable        # or --enable
npm run user:add -- alice --remote --delete         # removes the account and its progress
```

Losing `AUTH_PEPPER` means rotating every account; self-registered users would need a new account. To rotate the pepper itself: set a new secret, then `--rotate` every user.

## KOReader setup (each device)

1. Open a book → Tools → Progress sync → Custom sync server → `https://kosync.<your-subdomain>.workers.dev`.
2. **Login** with credentials from `npm run user:add`, or **Register** if your mode allows it.
3. Progress sync → Document matching method: use the **same** method on every device (default: binary).
4. Try it on one device and a test book first, then roll out.

Data from an old sync server doesn't need migrating: each device pushes its own position on its next sync.

## Testing

```sh
npm test                    # unit tests (local workerd + D1)
npm run typecheck
npm run dev                 # local server on :8787 (uses .dev.vars; copy .dev.vars.example)
npm run conformance         # verifier against the local server; needs the two local test users (CLAUDE.md)
npm run conformance -- --registration open    # when the server runs with REGISTRATION "open"
npm run conformance -- https://kosync.<your-subdomain>.workers.dev   # remote; see scripts/conformance.mjs
```

For a local open-mode check: `npm run dev -- --var REGISTRATION:open`. Remote runs need two throwaway accounts (`KOSYNC_TEST_USER`, `KOSYNC_TEST_PASSWORD`, `KOSYNC_TEST_USER2`, `KOSYNC_TEST_PASSWORD2`); delete them afterwards. In open mode, the verifier also registers a `reg-<time>` account: delete that too.

## Backup and restore

- Time Travel (automatic, 7 days): `npx wrangler d1 time-travel restore kosync --timestamp=<unix or RFC3339>`.
- Monthly and before every migration: `npm run backup` → `backups/*.sql`. It contains reading history and password hashes: store it encrypted, outside Cloudflare.
- Restore into a fresh DB: `npx wrangler d1 create kosync-restore`, then `npx wrangler d1 execute kosync-restore --remote --file backups/<file>.sql`, then switch `database_id`/`database_name` and deploy.
- Worst case, with no backup: re-create the accounts and let the devices re-push.

## Rollback

`npx wrangler deployments list`, then `npx wrangler rollback <version-id>`.

## FAQ

**Does this cost anything?**
No, as long as you stay on the Workers Free plan. Don't subscribe to Workers Paid, and don't enable add-ons such as R2 or Logpush for this project. On the free plan, going over a limit makes requests fail until 00:00 UTC; nothing is ever charged. It's still worth checking Dashboard → Billing → Subscriptions now and then to confirm nothing paid is active.

**How much of the free allowance does it use?**
A household uses well under 1% of the daily limits: 100,000 requests, 5 million database rows read and 100,000 rows written.

**Can someone break my server with junk traffic?**
They can't read or change your data, and they can't cost you money. But anyone who finds your URL can send enough junk requests to use up the free plan's 100,000 requests for the day, in any registration mode. Sync then stops for everyone until 00:00 UTC and resumes by itself. Your devices keep their own positions in the meantime, and nothing is lost.

**Can people find my server?**
Assume so. `*.workers.dev` hostnames show up in public certificate logs and get scanned. Your safety comes from strong passwords and your registration mode, not from the URL being secret.

**How safe are passwords?**
The server stores only a peppered HMAC of each login key and compares in constant time. The weak point is KOReader's sync protocol itself: the device sends an unsalted MD5 of your password with every request. HTTPS protects it in transit, but anyone who gets hold of a device's settings effectively has the login, and a reused password could be cracked from that MD5. So use a unique, generated password for sync. Accounts made with `npm run user:add` get one automatically.

**Is "open" registration safe?**
Only if you accept the trade-offs. Strangers can create accounts and use up your free daily writes. People choose their own passwords, which the server can't check for strength, and there's no rate limiting to slow down guessing. It's fine for an experiment or a small community that knows the risks. For yourself and people you know, use `"allowlist"` or `"off"`.

**What does the server store?**
Per account: the username, the password hash, and for each book a document id (a hash of the file), the reading position, the percentage, the device name and when it was saved. It doesn't store book titles, authors or file names, even if KOReader sends them. Request logging is off.

**Does it sync reading statistics?**
No, only reading progress. KOReader's statistics sync uses a separate mechanism (WebDAV/Dropbox) and isn't affected.

## License

MIT. See [LICENSE](LICENSE).
