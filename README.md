# Чем дышим

A Russian-language static website about Bishkek air quality and clean heating. It runs entirely on free GitHub services: GitHub Pages serves the site, and GitHub Actions refreshes the data every 30 minutes. There are no servers to run and nothing to pay for.

**Live site:** https://rasulovnazim-design.github.io/chem-dyshim/

The site works before you add anything below, using a free air quality model. Each secret switches on one more feature.

| Secret | What it switches on | Without it |
|---|---|---|
| `WAQI_TOKEN` | Real sensor readings by district | The site shows a model estimate that can read much lower than real smog |
| `TELEGRAM_BOT_TOKEN` | Posting to your channel | Nothing is posted |
| `TELEGRAM_CHAT_ID` | Says which channel to post to | Nothing is posted |
| `ANTHROPIC_API_KEY` | A three-sentence daily news summary | The summary is skipped silently |

## Step 1. Get a free WAQI token

**Read this first.** WAQI's terms ask non-profit public users to notify them by email before public use, ask for-profit users to get explicit agreement, forbid use in paid services, and say the data "can not be redistributed as cached or archived data". This site keeps a seven-day history in a public repository, so write to them, describe the project, and ask whether that is acceptable. Their address is on the page below. Until you add the token, no WAQI data is stored.

1. Open https://aqicn.org/data-platform/token/
2. Enter your email and your name, and agree to the terms.
3. Open the confirmation email and click the link. The token, a long string of letters and numbers, appears on the page.
4. Copy it and keep it for step 3.

## Step 2. Create a Telegram bot and channel

**Create the bot**

1. In Telegram, open a chat with **@BotFather** (check it has the blue tick).
2. Send `/newbot`.
3. Send a display name, for example `Чем дышим`.
4. Send a username that ends in `bot`, for example `chemdyshim_kg_bot`.
5. BotFather replies with a token like `123456789:ABCdef...`. This is your `TELEGRAM_BOT_TOKEN`. Treat it like a password.

**Create the channel**

1. In Telegram, tap the new message button and choose **New Channel**.
2. Name it and choose **Public**. Pick a link such as `t.me/chemdyshim_kg`.
3. Open the channel, then **Administrators**, then **Add Admin**. Search for your bot's username and add it. It only needs permission to post messages.

**Find the chat id**

For a public channel, the chat id is just `@` plus the channel link name, for example `@chemdyshim_kg`. That text is your `TELEGRAM_CHAT_ID`.

If you made a private channel instead:

1. Post any message in the channel.
2. Open this address in a browser, with your own token in place of `TOKEN`: `https://api.telegram.org/botTOKEN/getUpdates`
3. Find `"chat":{"id":-100...`. That number, including the minus sign, is your `TELEGRAM_CHAT_ID`. If the page shows an empty list, post another message and reload.

## Step 3. Add the secrets to GitHub

1. Open https://github.com/rasulovnazim-design/chem-dyshim/settings/secrets/actions
2. Click **New repository secret**.
3. In **Name**, type the name exactly as shown below. In **Secret**, paste the value. Click **Add secret**.
4. Repeat for each one:
   - `WAQI_TOKEN`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `ANTHROPIC_API_KEY` (optional, from https://console.anthropic.com/. The API is billed by usage, but one short summary a day costs very little.)

Then run the workflow once to check them. Open https://github.com/rasulovnazim-design/chem-dyshim/actions/workflows/update.yml, click **Run workflow**, then **Run workflow** again. When it finishes, open the run and read the "Получить воздух и новости" step. It says which source was used.

Nothing is posted to the channel in bulk when you first connect it. Existing news is marked as already seen, and only new items are posted from then on.

## Step 4. Fill in your own details

Edit [`config/site.js`](config/site.js). You can do this on the GitHub website: open the file, click the pencil icon, change it, and click **Commit changes**.

- `telegramChannel`: your channel link name without `@`. This turns on the subscribe button.
- `contact.telegram` and `contact.whatsapp`: where the "Получить расчёт от установщика" form sends people. Until at least one is set, the form explains that requests are not open yet.
- `makers`: a sentence about who makes the site, for the About page.
- `supportUrl`: a donation link, if you have one.

## Files you may want to edit

| To change | Edit |
|---|---|
| Your contact details and channel | [`config/site.js`](config/site.js) |
| News keywords | [`config/keywords.json`](config/keywords.json), instructions are at the top of the file |
| Shop links, for example to replace them with partner links | [`config/shops.js`](config/shops.js) |
| Purifier models, prices and specs | [`config/purifiers.js`](config/purifiers.js) |
| Electricity tariff, coal price and other calculator numbers | [`config/tariffs.js`](config/tariffs.js) |
| RSS feeds, city boundaries for sensors, fallback points | [`config/sources.js`](config/sources.js) |
| Any interface text, in Russian or Kyrgyz | [`assets/i18n.js`](assets/i18n.js) |

**Prices and tariffs go out of date.** Check `config/purifiers.js` and `config/tariffs.js` at least once a season, especially when the electricity tariff changes.

**Before adding partner links:** the free Open-Meteo API is for non-commercial use, and WAQI forbids use in paid services and asks for-profit users to get agreement. Check both sets of terms first. Also update the sentence about partner links on the About page.

## How it works

Every 30 minutes `.github/workflows/update.yml` does the following:

1. `scripts/update.mjs` fetches air data. It always fetches the Open-Meteo model and, if there is a token, WAQI stations too. News is fetched hourly. It writes `data/aqi.json`, `data/now.json` and `data/news.json`.
2. It works out what to post to Telegram and commits that decision with the data.
3. `scripts/notify.mjs` sends the posts, and the result is committed.

A commit to `main` makes GitHub Pages republish the site.

**One source failing does not stop the rest.** Each feed and API is handled separately, and its status is recorded in the data files. If every air source fails, the last good data stays in place and the page shows a notice.

**Nothing is posted twice.** A post is recorded in `data/state.json` and pushed to the repository *before* it is sent. If a run dies part-way, the next run does not resend. The cost of this design is that a post can occasionally be lost, which is better than a duplicate.

**The schedule is approximate.** GitHub can delay scheduled runs, sometimes by an hour at busy times. That is why the morning post goes out on the first run between 07:00 and 10:00 Bishkek time rather than at an exact minute. GitHub also pauses schedules in repositories with no activity for 60 days. The data commits should count as activity, but if updates stop, check the Actions tab.

**History size.** About 48 commits a day land on `main`. That is normal for this design, and it will make the repository grow slowly over the years.

## Working on it locally

You need Node 20 or newer.

```bash
npm test
```

```bash
npm run update
```

```bash
npm run preview
```

Then open http://localhost:4410. `npm run update` with no secrets set uses the fallback source and sends nothing. `npm install` is only needed if you want to test the news summary.

The district shapes in `config/` come from OpenStreetMap. `npm run geometry` downloads them again, but the map inside `index.html` is pasted in, so it has to be replaced by hand if the boundaries ever change.

## Credits

Air quality data: [World Air Quality Index Project](https://aqicn.org/) and originating agencies, and [Open-Meteo](https://open-meteo.com/) with CAMS (Copernicus Atmosphere Monitoring Service) data, CC BY 4.0. Map boundaries: © OpenStreetMap contributors, ODbL.
