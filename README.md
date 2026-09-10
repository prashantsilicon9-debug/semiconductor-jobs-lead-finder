# Semiconductor Jobs Lead Finder

A search-driven job-board Actor for **semiconductor engineering staffing lead generation**.

It does **not** scrape the boards itself. On each run it calls three proven, maintained
Apify Store scrapers with your search terms, then does the part that matters for lead-gen:
**normalize → filter out staffing agencies → dedupe across sources → flag what's new →
sort → one clean table.**

| Board | Child Actor used | Notes |
|---|---|---|
| Indeed | [`borderline/indeed-scraper`](https://apify.com/borderline/indeed-scraper) | ~$0.005 / job |
| LinkedIn Jobs | [`curious_coder/linkedin-jobs-scraper`](https://apify.com/curious_coder/linkedin-jobs-scraper) | ~$0.001 / result, no login |
| Google Jobs | [`gio21/google-jobs-scraper`](https://apify.com/gio21/google-jobs-scraper) | ~$0.003 / job. Aggregates ZipRecruiter, Dice and many ATS boards |

> Child-Actor charges land on **your** Apify account, the same as if you ran them directly.

---

## Quick start

1. Leave the defaults as-is for a nationwide-US, past-24h sweep of all three niches.
2. Click **Start**.
3. When it finishes, open the **Dataset** tab → **Export** → Excel / CSV.

## Input (all optional)

| Field | Default | What it does |
|---|---|---|
| `niches` | all three | DV / Verification · RTL / PD / STA · SerDes / Photonics. Each expands to 4 search strings. |
| `customQueries` | – | If set, replaces the niche presets entirely. One search string per line. |
| `sources` | all three | Which boards to run. |
| `location` | *(blank)* | Blank = nationwide US. Otherwise a city/state/region string. |
| `countryCode` | `us` | Scopes the search domains. |
| `datePosted` | `past24Hours` | Recency window. Keep at 24h for a daily schedule. |
| `maxJobsPerQueryPerSource` | `60` | Cap per search string for Indeed and LinkedIn. |
| `googleMaxItems` | `200` | Total cap for Google Jobs. |
| `excludeStaffingAgencies` | `true` | Drops postings whose hiring company looks like a staffing firm / recruiter / consultancy. |
| `extraExcludeCompanies` | – | Extra company-name substrings to filter (add your own firm + known competitors). |
| `onlyNewSinceLastRun` | `false` | ON = dataset holds only postings first seen today. OFF = every current match, each flagged `is_new`. |
| `descriptionSnippetLength` | `300` | Characters of description kept per row. |
| `dailyBudgetUsd` | `3` | Advisory only — logs a warning if the projected cost is higher. Does not hard-stop. |
| `googleSheetUrl` | – | Stored with the run for reference. Actual Sheet delivery is the integration below. |

### Cost control

Worst-case child-Actor cost ≈
`queries × maxJobsPerQueryPerSource × ($0.005 + $0.001)` + `googleMaxItems × $0.003`.

With the defaults (12 queries, 60/query, 200 Google) that's **~$4.9 worst case**, typically
**$1–3** because 24h windows rarely return the full cap. To stay under $3 hard: set
`maxJobsPerQueryPerSource` to `40` and `googleMaxItems` to `150`, or drop Indeed.

## Output

One row per unique posting. Columns:

`posted_date`, `is_new`, `niche`, `job_title`, `company`, `location`, `work_type`
(remote/hybrid/onsite), `salary`, `company_website`, `company_linkedin_url`,
`company_size`, `job_poster_name`, `job_poster_title`, `source`, `sources_seen`,
`search_query`, `apply_url`, `job_description_snippet`, `first_seen`, `date_scraped`,
`stable_id`.

Contact/company fields (`job_poster_*`, `company_linkedin_url`, `company_size`,
`company_website`) populate mostly from LinkedIn and some Indeed records — Google Jobs
rarely has them.

`stable_id` is a hash of company + title + city. It's how the Actor decides `is_new`
across runs (state kept in the key-value store `SEEN_JOBS`, entries expire after 60 days),
and it's the field to **deduplicate on** in the Google Sheets integration.

The key-value store also gets a `SUMMARY` record: counts per source, per niche, how many
were new, projected cost.

---

## Deliver to a Google Sheet

Done with Apify's built-in integration, not code — so there's no fragile auth in the Actor.

1. Create a Google Sheet, add a header row matching the columns above (or leave it empty).
2. Copy the Sheet URL into the `googleSheetUrl` input (for your own reference).
3. In this Actor (or your Task) → **Integrations** → **Google Sheets** → **Connect**.
4. Authorize your Google account once.
5. Configure:
   - **Spreadsheet**: your Sheet
   - **Mode**: `Append`
   - **Deduplicate rows by field**: `stable_id`
6. Save. From now on every run appends only genuinely new rows.

## Schedule it daily

Actor → **Schedules** → **Create** → cron e.g. `0 13 * * *` (13:00 UTC) → select this
Actor/Task. Keep `datePosted` = `past24Hours`.

---

## Deploy / update from GitHub

This repo is wired for Apify's GitHub integration.

- **First time**: Apify Console → **Actors** → **Develop new** → **Link GitHub repo** →
  pick this repo. Apify reads `.actor/actor.json` and builds automatically.
- **Updates**: `git push` to the default branch, then hit **Build** in the Actor (or
  enable auto-build on push in the Actor's **Builds** settings).

Local dev (optional, needs Node 18+ and the Apify CLI):

```bash
npm install
apify run -p          # runs with .actor/input_schema.json defaults, purges storage
```
