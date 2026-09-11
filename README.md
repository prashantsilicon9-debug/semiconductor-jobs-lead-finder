# Semiconductor Jobs Lead Finder

A search-driven **LinkedIn Jobs** scraper for **semiconductor engineering staffing lead
generation** — built natively (no dependency on other developers' Apify Actors).

## Why native, not composed

The first version of this Actor called three third-party Store scrapers (Indeed, LinkedIn,
Google Jobs). That's blocked on an Apify Creator-plan account: Creator-plan accounts can only
run Actors they own, not other developers' public Store Actors. Since those Actors are also
closed-source, "cloning" them isn't an option either. This version scrapes directly instead —
fully owned code, runs on any plan.

## What it does, and its real limits

| Source | Status | Notes |
|---|---|---|
| **LinkedIn Jobs** | ✅ Implemented | Public guest search endpoint (no login) + each posting's own schema.org `JobPosting` structured data for description/salary/industry. Verified against live results before shipping. |
| **Indeed** | Not implemented | Cloudflare-protected; needs Playwright + a paid residential proxy and will still get intercepted sometimes. Flagged as a follow-up, not built into v1. |
| **Google Jobs** | Not implemented | Google's HTML uses obfuscated CSS class names that don't even stay stable between two consecutive requests in testing — no reliable selector to hook a scraper to. Deliberately dropped rather than shipping something that silently returns 0 rows after a few days. |

If you want Indeed and/or Google Jobs added later, that's a separate, harder build — ask and
we'll scope it (most likely Indeed via Playwright + residential proxy as the next step, Google
Jobs only if a more stable extraction method turns up).

## How the LinkedIn scrape works

1. For each search query, page through LinkedIn's public **guest job-search API**
   (`linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`) — no login, no cookies.
   This returns title, company, location, a job link, and an exact ISO posted-date per card.
2. Filter out postings that look like staffing agencies (competitors, not clients) and any
   extra company names you list.
3. Dedupe postings that surfaced under more than one search query.
4. *(optional, default on)* For each unique posting, fetch its job page and read the
   `schema.org JobPosting` JSON-LD block LinkedIn embeds there (published for Google Jobs
   indexing) — this gives a real description, salary, industry and employment type far more
   reliably than parsing the visible page.
5. Track what's new vs already seen (key-value store `SEEN_JOBS`, 60-day rolling window),
   sort, and write one row per posting.

## Input (all optional)

| Field | Default | What it does |
|---|---|---|
| `niches` | all three | DV / Verification · RTL / PD / STA · SerDes / Photonics. Each expands to 4 search strings. |
| `customQueries` | – | If set, replaces the niche presets entirely. One search string per line. |
| `location` | *(blank)* | Blank = nationwide United States. Otherwise a city/state/region as you'd type it on LinkedIn. |
| `datePosted` | `past24Hours` | Recency window. Keep at 24h for a daily schedule. |
| `maxJobsPerQuery` | `25` | Cap per search string. 25 = one search page; higher pages further and takes longer. |
| `fetchFullDetails` | `true` | Adds one request per unique posting for description/salary/industry. Turn off for a faster, thinner run. |
| `excludeStaffingAgencies` | `true` | Drops postings whose hiring company looks like a staffing firm / recruiter / consultancy. |
| `extraExcludeCompanies` | – | Extra company-name substrings to filter (add your own firm + known competitors). |
| `onlyNewSinceLastRun` | `false` | ON = dataset holds only postings first seen today. OFF = every current match, each flagged `is_new`. |
| `descriptionSnippetLength` | `300` | Characters of description kept per row (only used when `fetchFullDetails` is on). |
| `googleSheetUrl` | – | Stored with the run for reference. Actual Sheet delivery is the integration below. |

### Runtime / politeness

Requests to LinkedIn are paced (small delay between search pages, limited concurrency on
detail-page fetches) to avoid tripping rate limits. A full run — 12 default queries × 25 jobs
× detail fetch — is usually a few minutes. Raise `maxJobsPerQuery` gradually rather than
jumping straight to the max; LinkedIn can rate-limit or temporarily block an IP that requests
too aggressively, which would show up as a run with unexpectedly few results.

## Output

One row per unique posting:

`posted_date`, `is_new`, `niche`, `job_title`, `company`, `location`, `work_type`
(remote/hybrid/onsite), `employment_type`, `salary`, `industry`, `company_linkedin_url`,
`source`, `search_query`, `apply_url`, `job_description_snippet`, `first_seen`,
`date_scraped`, `stable_id`.

`salary`, `industry`, `employment_type` and the real `job_description_snippet` only populate
when `fetchFullDetails` is on (default) — LinkedIn's search-result cards alone don't carry
them.

`stable_id` is a hash of company + title + city. It's how the Actor decides `is_new` across
runs (state kept in the key-value store `SEEN_JOBS`, entries expire after 60 days), and it's
the field to **deduplicate on** in the Google Sheets integration.

The key-value store also gets a `SUMMARY` record: query count, raw rows, agency-filter
removals, unique postings, how many were new.

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

- **First time**: Apify Console → **Actors** → **Develop new** → **Link Git repository** →
  paste this repo's URL. Apify reads `.actor/actor.json` and builds automatically.
- **Updates**: `git push` to the default branch, then hit **Build** in the Actor.

Local dev (optional, needs Node 18+ and the Apify CLI):

```bash
npm install
apify run -p          # runs with .actor/input_schema.json defaults, purges storage
```
