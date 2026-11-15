<p align="center">
  <img src="images/header.jpg" width="320" alt="An e-reader in space, sending a bookmark to a cloud of books">
</p>

<h1 align="center">KOsync for Cloudflare</h1>

<p align="center">
  Your own reading-progress sync server for KOReader, running free on Cloudflare.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers%20(free%20plan)-f38020.svg" alt="Runs on Cloudflare Workers (free plan)">
</p>

<p align="center">
  <a href="#why-use-this">Why use this?</a> ·
  <a href="#setup-guide">Setup guide</a> ·
  <a href="#registration-who-can-create-accounts">Registration</a> ·
  <a href="#faq">FAQ</a>
</p>

---

KOReader can keep your place in a book in step across your devices: read a chapter on your e-reader, pick up the same page on your phone. That progress syncing feature is called **KOSync**, and it needs a sync server. This project is a small sync server you run yourself, in your own free Cloudflare account. Nothing to install at home, nothing to pay for.

- Works with KOReader's built-in Progress sync. Just enter your server's address on each device.
- Runs on Cloudflare's free plan: one Worker (a small program) and one D1 database.
- Stores only reading positions. Never book titles, authors or file names, and keeps no request logs.
- You decide who can create accounts: only you, people you list, or anyone.
- Tested against [kosync-conformance](https://github.com/pid1/kosync-conformance), an independent checker for KOReader sync servers.

## Why use this?

KOReader's official sync server has had stability issues in recent months. They allow users to replace their default with a custom server, and there are good third-party servers out there, but using one means trusting someone else with your reading history and their uptime.

This project lets you run your own instead:

- **Your data, your account.** Reading positions live in a database in your own Cloudflare account. Nothing goes to a third party, and you can back it up, restore it or delete it whenever you like.
- **Free and always on.** It runs on Cloudflare's free Workers plan, on their global network, with nothing to keep running at home: no server, NAS or VPS. If a free-plan limit is ever reached, requests pause until midnight UTC; you are never billed.
- **Very little setup.** Following the guide below takes about 20–30 minutes the first time, and you only do it once. After that, KOReader just needs your server's address.

### Credits

- [KOReader](https://github.com/koreader/koreader) and the reference [koreader-sync-server](https://github.com/koreader/koreader-sync-server), whose behaviour defines the protocol.
- [kosync-conformance](https://github.com/pid1/kosync-conformance) by pid1: the protocol description this server is built from, and the checker it's tested against (downloaded at test time, not bundled).
- [nperez0111/koreader-sync](https://github.com/nperez0111/koreader-sync), a self-hosted KOSync server (Bun, Hono and SQLite, run with Docker) that inspired this one. This is a separate implementation for Cloudflare Workers, not a port.

Co-developed with Claude Opus 5.5 (Anthropic).

## Setup guide

You'll type a few commands into a terminal (the text window where you run commands). Every step says what to type and why. Where Windows, macOS and Linux differ, open the section for your system.

> **Tested on Windows.** The macOS and Linux steps use the same tools and should work, but haven't been tested yet. If something doesn't match what you see, please open an issue.

### What you'll need

- A computer running Windows, macOS or Linux. You only need it for setup and occasional changes; your server runs on Cloudflare.
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up). You don't need a domain name or a payment method.
- A password manager (or another safe place to keep a secret). You'll create one value, the *pepper*, that you must not lose.
- About 20–30 minutes.

### Step 1: Open a terminal

<details>
<summary><b>Windows</b></summary>

Press the Windows key, type `cmd` and open **Command Prompt**. Use Command Prompt for everything in this guide.

Why not PowerShell or Git Bash? PowerShell may refuse to run `npm` with a "running scripts is disabled" error, and Git Bash can fail silently when a command asks you to type something. Command Prompt has neither problem.
</details>

<details>
<summary><b>macOS</b></summary>

Press Cmd+Space, type `Terminal` and open it.
</details>

<details>
<summary><b>Linux</b></summary>

Open your terminal app (often Ctrl+Alt+T).
</details>

### Step 2: Install Git and Node.js

- **Git** downloads this project to your computer.
- **Node.js** runs the setup tools, including Cloudflare's command-line tool, *wrangler*. You need **Node.js 22.12 or newer**. The "LTS" version from nodejs.org is right.

<details>
<summary><b>Windows</b></summary>

In Command Prompt, run these two commands, accepting any prompts:

```bat
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

If `winget` isn't recognised, download the installers instead from [git-scm.com](https://git-scm.com/downloads) and [nodejs.org](https://nodejs.org/) and accept the defaults.

Then **close Command Prompt and open a new one**, so it picks up the newly installed programs.
</details>

<details>
<summary><b>macOS</b></summary>

1. Download and run the **LTS** installer from [nodejs.org](https://nodejs.org/).
2. In Terminal, run `git --version`. If Git isn't installed yet, macOS offers to install the Command Line Developer Tools. Accept, wait for it to finish, then run `git --version` again.

If you use [Homebrew](https://brew.sh), `brew install node git` does both.

Then close Terminal and open a new window.
</details>

<details>
<summary><b>Linux</b></summary>

Install Git with your package manager, for example `sudo apt install git` (Debian/Ubuntu) or `sudo dnf install git` (Fedora).

Many distributions ship an older Node.js. Check with `node --version` after installing; if it's older than 22.12, use the instructions for your distribution on [nodejs.org/en/download](https://nodejs.org/en/download) (the nvm option works everywhere).
</details>

Check that both work. Each command should print a version number:

```sh
git --version
node --version
```

### Step 3: Download this project

This copies the project into a new folder called `cloudflare-koreader-sync`, moves into it, and installs the tools it needs. `npm install` only puts files inside the project folder, not across your system. It can take a minute.

```sh
git clone https://github.com/uncrasimatic/cloudflare-koreader-sync.git
cd cloudflare-koreader-sync
npm install
```

From now on, always run commands from inside this folder. If you open a new terminal later, run `cd` with the folder's path first, for example `cd cloudflare-koreader-sync` from your home folder.

### Step 4: Connect to your Cloudflare account

```sh
npx wrangler login
```

Your browser opens on a Cloudflare page. Sign in if asked and click **Allow**. This gives the setup tools permission to create the database and server in your account. You can return to the terminal when it says you're logged in.

(`npx` runs a tool installed in the project folder. Wrangler may also ask whether to share usage data with Cloudflare; answer either way.)

### Step 5: Create the database

```sh
npx wrangler d1 create kosync --location weur
```

This creates an empty database called `kosync` in your account. `--location` is a hint for where in the world to keep it; choose the one nearest you: `weur` (Western Europe), `eeur` (Eastern Europe), `wnam` (Western North America), `enam` (Eastern North America), `apac` (Asia-Pacific) or `oc` (Oceania).

If wrangler asks whether to add the database to your configuration for you, answer **No**: you'll do it yourself in the next step, so it ends up in the right place.

The output includes a line like `"database_id": "1a2b3c4d-..."`. Keep the terminal open; you need that id next.

### Step 6: Put your database id into the settings file

The file `wrangler.jsonc` holds your server's settings. It ships with a placeholder id made of zeros, which you replace with your own.

Open it in a plain-text editor:

<details>
<summary><b>Windows</b></summary>

```bat
notepad wrangler.jsonc
```
</details>

<details>
<summary><b>macOS</b></summary>

```sh
open -e wrangler.jsonc
```

This opens TextEdit. Only paste text in; don't type quote marks, because TextEdit may turn them into "smart" quotes that break the file.
</details>

<details>
<summary><b>Linux</b></summary>

```sh
nano wrangler.jsonc
```

Save with Ctrl+O then Enter, and exit with Ctrl+X.
</details>

Find this line:

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000",
```

Replace only the zeros between the quote marks with your id from step 5. Keep the quotes and the comma. Don't save yet.

### Step 7: Choose who can create accounts

In the same file, find this line:

```jsonc
"vars": { "REGISTRATION": "off" },
```

This controls what KOReader's **Register** button does:

- `"off"`: nobody can register from a device; you create accounts with a command (step 11). The safest choice, and the default.
- `"allowlist"`: only the usernames you list can register from their device, without you running commands for them. Good for a household.
- `"open"`: anyone who finds your server can create an account. Only for public servers.

If you're unsure, leave it as `"off"`; you can change it any time. [Registration](#registration-who-can-create-accounts) explains each option in detail.

Now save the file and close the editor.

### Step 8: Create your secret pepper

The *pepper* is a random secret that the server mixes into every stored password. Even if someone copied your database, they couldn't use or crack the stored passwords without it.

Generate one:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

It prints a line of random characters. **Copy it into your password manager now** and label it something like "KOReader sync pepper". You need it again whenever you create accounts with the command line. If you lose it, every account needs a new password.

Then give it to your server:

```sh
npx wrangler secret put AUTH_PEPPER
```

When asked, paste the pepper and press Enter. Nothing shows on screen as you paste; that's normal. It should finish with **Success! Uploaded secret AUTH_PEPPER**.

Check it arrived. This shows the secret's name, never its value:

```sh
npx wrangler secret list
```

It must list `AUTH_PEPPER`. If it shows `[]`, run the `secret put` command again (on Windows, make sure you're in Command Prompt).

### Step 9: Create the tables and put your server online

```sh
npm run db:migrate:remote
```

This sets up the two tables (accounts and reading positions) in your database. Answer **Y** if asked to confirm.

```sh
npm run deploy
```

This uploads the server to Cloudflare. If this is your first Worker, wrangler asks you to choose a *workers.dev subdomain*; it becomes part of your server's address. **Don't use your real name**: the address is public.

At the end it prints your server's address, like `https://kosync.your-subdomain.workers.dev`. **Write it down.**

### Step 10: Check it's working

Open your address with `/healthcheck` on the end in a web browser, for example:

```
https://kosync.your-subdomain.workers.dev/healthcheck
```

You should see `{"state":"OK"}`. Your server is live.

### Step 11: Create your account

<details open>
<summary><b>If you chose <code>"off"</code>: create the account with a command</b></summary>

The account tool needs your pepper. You load it into this terminal window only, without saving it anywhere. Replace `alice` with the username you want.

**Windows (Command Prompt):**

```bat
set /p AUTH_PEPPER=Paste your pepper, then press Enter: 
cls
npm run user:add -- alice --remote
```

The pepper is visible on screen while you paste it; `cls` clears the screen. It's forgotten when you close the window.

**macOS / Linux:**

```sh
read -rs AUTH_PEPPER && export AUTH_PEPPER
npm run user:add -- alice --remote
```

After the first line, paste the pepper and press Enter. Nothing shows while you paste.

The tool prints a **generated password once**. Save it in your password manager straight away; it can't be shown again.
</details>

<details>
<summary><b>If you chose <code>"allowlist"</code>: add your username to the list</b></summary>

Follow [Using the allowlist](#using-the-allowlist), then tap **Register** on your device in step 12 instead of Login.
</details>

### Step 12: Set up KOReader on each device

1. Open any book in KOReader.
2. Open the top menu → **Tools** (the wrench icon) → **Progress sync** → **Custom sync server**, and enter your address (for example `https://kosync.your-subdomain.workers.dev`).
3. Tap **Login** and enter your username and password. With the allowlist, tap **Register** the first time instead.
4. In **Progress sync** → **Document matching method**, choose the **same** option on every device. It's how devices recognise that they have the same book; if they differ, positions never meet. The default ("binary") is fine.
5. Try it with one book on two devices before relying on it.

If you used another sync server before, there's nothing to move over: each device sends its own position the next time it syncs.

## Registration: who can create accounts

KOReader's Progress sync screen has **Register** and **Login** buttons. `REGISTRATION` in `wrangler.jsonc` decides what Register does. It takes effect when you deploy, so run `npm run deploy` after changing it. Change it in the file, not in the Cloudflare dashboard: dashboard edits to plain variables are overwritten by the next deploy, and adding one there can switch registration off (see the warning below).

| Mode | Who can create an account | Good for | Risks you accept |
|---|---|---|---|
| `"off"` (default; also used if the value is missing or misspelled) | Only you, with `npm run user:add` from a terminal | Maximum safety | None beyond the basics |
| `"allowlist"` | Usernames you list in the `ALLOWED_NEW_USERS` secret | Households and friends, without a terminal session per person | A listed name goes to whoever registers it first; people pick their own passwords |
| `"open"` | **Anyone** who knows or finds your address | Public or community servers | Strangers can create accounts and store data; weak passwords can be guessed |

In every mode, Register on an existing name fails ("Username is already registered"), so registering can't take over an account. `npm run user:add` works in every mode for changing passwords, disabling and deleting accounts.

### Why the modes differ in safety

- **Passwords.** `npm run user:add` generates a random password that can't realistically be guessed. With Register, people type their own password on the e-reader. KOReader sends only a scrambled form of it (an MD5 hash), so the server **can't check how strong it is**. There's no rate limiting, so a weak password can be guessed. Ask everyone who registers to use a long password from a password manager.
- **Your address isn't secret.** `*.workers.dev` addresses appear in public certificate logs and get scanned. In `"open"` mode, assume strangers will find it.
- **Free-plan limits.** In `"open"` mode, a flood of sign-ups can use up the day's free database writes. Sync then stops for everyone until 00:00 UTC, but nothing is ever billed.
- **Allowlist refusals look like "off".** A name that isn't on the list gets the same "registration is disabled" answer, so a stranger can't tell your server uses an allowlist.

### Using the allowlist

1. In `wrangler.jsonc`, set `"vars": { "REGISTRATION": "allowlist" }`, then run `npm run deploy`. Until you add the list, nobody can register.
2. Add the names that may register: letters, digits, `.`, `_` or `-` (up to 64 characters each), separated by commas, for example `alice,bob`. Names are case-sensitive: `Alice` and `alice` are different. Don't add quote marks. Either:
   - **In the Cloudflare dashboard (no terminal):** Workers & Pages → `kosync` → Settings → Variables and Secrets → **Add**. Set **Type** to **Secret**, **Variable name** to `ALLOWED_NEW_USERS` and **Value** to your list, then click **Deploy**.
   - **In the terminal:** run `npx wrangler secret put ALLOWED_NEW_USERS` and type the list when asked.

   The list takes effect within seconds and survives later deploys.

   > ⚠️ **The Type must be Secret, not Text.** Adding a *Text* variable in the dashboard creates a new live version that keeps only the dashboard's variables. It drops `REGISTRATION`, so the server falls back to `"off"` and every Register says "registration is disabled". If that happens, delete the Text variable, run `npm run deploy`, then add the list as a Secret.

   > **Secrets are write-only.** Once saved, nobody can view a secret's value, not even you, so the dashboard shows only a **Rotate** button. *Rotate* means "replace the value": type the complete new list. It doesn't generate anything random.
3. On each person's device: Progress sync → Custom sync server → your address → **Register**, with their username and a strong password.
4. When everyone has registered, delete the secret (dashboard: the **⋯** menu next to it → Delete, or `npx wrangler secret delete ALLOWED_NEW_USERS`). Existing accounts keep working.

To lock everything down again, set `REGISTRATION` back to `"off"` and deploy. Existing accounts keep working.

## Managing accounts

Load your pepper first, as in [step 11](#step-11-create-your-account), then:

```sh
npm run user:add -- alice --remote             # create an account (prints a generated password once)
npm run user:add -- alice --remote --rotate    # give it a new password
npm run user:add -- alice --remote --disable   # block it (--enable to undo)
npm run user:add -- alice --remote --delete    # delete it and its reading positions
```

If you ever lose the pepper, set a new one (`npx wrangler secret put AUTH_PEPPER`) and give every account a new password with `--rotate`. Self-registered users need to register again.

## Updating to a new version

From the project folder:

```sh
git pull
npm install
npm run deploy
```

`git pull` downloads the latest code, `npm install` updates the tools, and `npm run deploy` puts the new version online. Your `wrangler.jsonc` edits are normally kept. If an update also changed that file, `git pull` stops and says your local changes would be overwritten. In that case, note down your database id and registration choice, run `git checkout wrangler.jsonc` to discard your edits, run `git pull` again, then redo steps 6 and 7.

## Backups and undo

- **Automatic (7 days):** Cloudflare keeps a point-in-time history of your database. To go back: `npx wrangler d1 time-travel restore kosync --timestamp=<time>`, where the time is like `2026-11-01T12:00:00Z`.
- **Your own copies:** `npm run backup` saves the whole database to the `backups` folder. Do it monthly and before updates. The file contains reading history and password hashes, so store it somewhere private, ideally encrypted.
- **Undo a deploy:** `npx wrangler deployments list` shows recent versions; `npx wrangler rollback <version-id>` switches back to one.
- **Worst case:** with no backup at all, re-create the accounts and let each device send its position again.

## FAQ

**Does this cost anything?**
No, as long as you stay on the Workers Free plan. Don't subscribe to Workers Paid, and don't enable add-ons such as R2 or Logpush for this project. On the free plan, going over a limit makes requests fail until 00:00 UTC; nothing is ever charged. It's still worth checking Dashboard → Billing → Subscriptions now and then to confirm nothing paid is active.

**How much of the free allowance does it use?**
A household uses well under 1% of the daily limits: 100,000 requests, 5 million database rows read and 100,000 rows written.

**Can someone break my server with junk traffic?**
They can't read or change your data, and they can't cost you money. But anyone who finds your address can send enough junk requests to use up the free plan's 100,000 requests for the day, in any registration mode. Sync then stops for everyone until 00:00 UTC and resumes by itself. Your devices keep their own positions in the meantime, and nothing is lost.

**Can people find my server?**
Assume so. `*.workers.dev` addresses show up in public certificate logs and get scanned. Your safety comes from strong passwords and your registration mode, not from the address being secret.

**How safe are passwords?**
The server stores only a peppered, keyed hash (HMAC) of each login and compares them in constant time. The weak point is KOReader's sync protocol itself: the device sends an unsalted MD5 of your password with every request. HTTPS protects it in transit, but anyone who gets hold of a device's settings effectively has the login, and a reused password could be cracked from that MD5. So use a unique, generated password for sync. Accounts made with `npm run user:add` get one automatically.

**Is "open" registration safe?**
Only if you accept the trade-offs. Strangers can create accounts and use up your free daily writes. People choose their own passwords, which the server can't check for strength, and there's no rate limiting to slow down guessing. It's fine for an experiment or a small community that knows the risks. For yourself and people you know, use `"allowlist"` or `"off"`.

**What does the server store?**
Per account: the username, the password hash, and for each book a document id (a fingerprint of the file), the reading position, the percentage, the device name and when it was saved. It doesn't store book titles, authors or file names, even if KOReader sends them. Request logging is off.

**Does it sync reading statistics?**
No, only reading progress. KOReader's statistics sync uses a separate mechanism (WebDAV/Dropbox) and isn't affected.

**Every login fails with "Unknown server error". What's wrong?**
The server can't see your pepper. Run `npx wrangler secret list`; if `AUTH_PEPPER` is missing, repeat [step 8](#step-8-create-your-secret-pepper). On Windows, use Command Prompt.

**Register says "registration is disabled", but I set up the allowlist.**
Check that the name matches exactly, including capitals (e-reader keyboards often capitalise the first letter), and that `ALLOWED_NEW_USERS` was added as a **Secret**, not Text (see the warning in [Using the allowlist](#using-the-allowlist)).

## For developers

`SPEC.md` describes the wire protocol and this server's implementation choices. Code is in `src/`, tests in `test/`.

```sh
npm test                    # unit tests (run locally in Cloudflare's workerd runtime with a local D1)
npm run typecheck
npm run db:migrate:local    # local database schema
npm run dev                 # local server on http://localhost:8787 (copy .dev.vars.example to .dev.vars first)
```

Conformance checks with [kosync-conformance](https://github.com/pid1/kosync-conformance) need two local accounts:

```sh
npm run user:add -- conformance --local --password conformance-pass-1
npm run user:add -- conformance2 --local --password conformance-pass-2
npm run conformance                                   # against npm run dev
npm run dev -- --var REGISTRATION:open                # then, in another terminal:
npm run conformance -- --registration open            # also checks registration; delete the reg-<time> account afterwards
npm run conformance -- https://kosync.your-subdomain.workers.dev   # remote; see scripts/conformance.mjs
```

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  If this saves you some hassle, you can buy me a coffee:<br><br>
  <a href="https://ko-fi.com/J4G02APUTL" target="_blank"><img height="36" style="border:0px;height:36px;" src="https://storage.ko-fi.com/cdn/kofi5.png?v=6" border="0" alt="Buy Me a Coffee at ko-fi.com"></a>
</p>
