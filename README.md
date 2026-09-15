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
| **LinkedIn Jobs** | ✅ Implemented | Public guest search endpoint (no login) + each posting's own schema.org `JobPosting` structured data for description/salary/industry, plus a best-effort company-size lookup. Verified against live results before shipping. |
| **Indeed** | Not implemented | Cloudflare-protected; needs Playwright + a paid residential proxy and will still get intercepted sometimes. Flagged as a follow-up, not built into v1. |
| **Google Jobs** | Not implemented | Google's HTML uses obfuscated CSS class names that don't even stay stable between two consecutive requests in testing — no reliable selector to hook a scraper to. Deliberately dropped rather than shipping something that silently returns 0 rows after a few days. |

If you want Indeed and/or Google Jobs added later, that's a separate, harder build — ask and
we'll scope it (most likely Indeed via Playwright + residential proxy as the next step, Google
Jobs only if a more stable extraction method turns up).

### A real constraint worth understanding: LinkedIn's guest access is inconsistently gated

Confirmed live, twice: LinkedIn's public (no-login) pages — both job search results and
company pages — sometimes return a full sign-up wall instead of content, with no clear
trigger. One company's page loaded fine; the very next request, to a different company, came
back as a "Join LinkedIn" wall. This is almost certainly the same mechanism that made an
early run return real results for one niche and silently zero for two others in the same run.

The Actor handles this two ways:
1. **Detects the wall** (rather than treating it as a normal empty result) and retries once
   after a longer pause — often enough to get through.
2. **Runs searches fully sequentially with a pause between each**, not in parallel — slower,
   but far less likely to trip whatever's doing the gating.

It can still happen anyway, especially on a run with many niches × many locations (see the
warning the Actor logs above ~40 total searches). If a niche you asked for comes back with
zero results, that's the most likely explanation — try it again on its own, or with fewer
other niches/locations in the same run.

## How the LinkedIn scrape works

1. For each search query **and each location**, page through LinkedIn's public **guest
   job-search API** (`linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`) — no login,
   no cookies. Returns title, company, location, a job link, and an exact ISO posted-date per
   card.
2. Filter out postings that look like staffing agencies (competitors, not clients), postings
   from a heuristic list of well-known large employers, and any extra company names you list.
3. Dedupe postings that surfaced under more than one query or location.
4. *(optional, default on)* For each unique posting, fetch its job page and read the
   `schema.org JobPosting` JSON-LD block LinkedIn embeds there — real description, salary,
   industry, employment type.
5. *(optional, default on)* For each unique **company**, best-effort fetch its LinkedIn
   company page and read its self-reported employee-count band, then drop postings above
   `maxCompanySize`. A company whose size can't be confirmed (page inaccessible) is kept, not
   dropped — see the gating note above.
6. Track what's new vs already seen (key-value store `SEEN_JOBS`, 60-day rolling window),
   sort, and write one row per posting.

## Niches

Fifteen hardware-design niches are available; pick a handful per run rather than all of them
(see the search-volume note below):

`DV / Verification` · `RTL Design` · `Physical Design` · `STA` · `DFT` · `Emulation` ·
`Post-Silicon Validation` · `ASIC` · `SoC` · `SerDes` · `Photonics` · `Memory` · `HBM` ·
`NVMe` · `UCIe`

Each expands to 3-4 targeted search strings (see `src/constants.js` → `NICHE_QUERIES` for the
exact list, or use `customQueries` to bypass the presets entirely).

## Input (all optional)

| Field | Default | What it does |
|---|---|---|
| `niches` | DV/Verification, RTL Design, Physical Design | Which niches to run (see full list above). |
| `customQueries` | – | If set, replaces the niche presets entirely. One search string per line. |
| `locations` | `["United States", "Canada"]` | Every query runs once per location listed, LinkedIn-style free text. Two locations ≈ doubles the run. |
| `datePosted` | `past24Hours` | Recency window. Keep at 24h for a daily schedule. |
| `maxJobsPerQuery` | `25` | Cap per search string. 25 = one search page; higher pages further and takes proportionally longer. |
| `fetchFullDetails` | `true` | Adds one request per unique posting for description/salary/industry. |
| `excludeStaffingAgencies` | `true` | Drops postings whose hiring company looks like a staffing firm / recruiter / consultancy. |
| `extraExcludeCompanies` | – | Extra company-name substrings to filter (add your own firm + known competitors). |
| `excludeTopCompanies` | `true` | Drops a heuristic list of mega-cap/large employers (Google, Intel, Lockheed Martin, etc.) — see below. |
| `filterByCompanySize` | `true` | Best-effort employee-count lookup per unique company; drops postings above `maxCompanySize`. Unknown size is kept, not dropped. |
| `maxCompanySize` | `500` | Upper bound on employee count when `filterByCompanySize` is on. |
| `onlyNewSinceLastRun` | `false` | ON = dataset holds only postings first seen today. OFF = every current match, each flagged `is_new`. |
| `descriptionSnippetLength` | `300` | Characters of description kept per row (only used when `fetchFullDetails` is on). |
| `googleSheetUrl` | – | Stored with the run for reference. Actual Sheet delivery is the integration below. |

### Targeting: staffing-firm ICP, not just semiconductor keywords

Two filters work together to keep results to companies that actually hire *through* a
staffing firm rather than run their own recruiting org:

- **`excludeTopCompanies`** — a static blocklist of recognizable mega-caps (big tech, big
  semiconductor/EDA, big aerospace/defense). Catches well-known names even when the size
  lookup below can't get through. Not exhaustive by design; see `TOP_COMPANY_BLOCKLIST` in
  `src/constants.js` to extend it.
- **`filterByCompanySize`** / **`maxCompanySize`** — the real targeting mechanism: looks up
  each unique company's LinkedIn-reported size band (1-10, 11-50, 51-200, 201-500, 501-1,000,
  ...) and drops anything over the threshold (default 500 employees). Because the lookup
  itself is unreliable (see the gating note above), a company whose size can't be confirmed
  passes through rather than getting dropped — the tradeoff is a false negative (an
  unconfirmed large company slips through) over a false positive (a real small-company lead
  silently vanishes because LinkedIn happened to wall that one request).

### Runtime / politeness

All LinkedIn search requests run **sequentially with a ~1.5s pause between each**, not in
parallel — this is deliberate (see the gating note above), so more niches × more locations
means a proportionally longer run, not just more results. A default run (3 niches × ~10-12
queries × 2 locations ≈ 20-24 searches, detail-fetch and size-lookup on) typically takes a few
minutes. The Actor logs a warning above 40 total searches (queries × locations) in one run —
that's the point where LinkedIn's guest-access gating becomes a real risk. Prefer several
smaller, focused runs over one sweep across everything.

## Output

One row per unique posting:

`posted_date`, `is_new`, `niche`, `job_title`, `company`, `company_size_label`, `location`,
`work_type` (remote/hybrid/onsite), `employment_type`, `salary`, `industry`,
`company_linkedin_url`, `source`, `search_query`, `search_location`, `apply_url`,
`job_description_snippet`, `first_seen`, `date_scraped`, `stable_id`.

`salary`, `industry`, `employment_type` and the real `job_description_snippet` only populate
when `fetchFullDetails` is on (default). `company_size_label` only populates when the
size lookup succeeds — blank means unknown, not "unlimited size," and the row was kept
regardless (see targeting note above).

`stable_id` is a hash of company + title + city. It's how the Actor decides `is_new` across
runs (state kept in the key-value store `SEEN_JOBS`, entries expire after 60 days), and it's
the field to **deduplicate on** in the Google Sheets integration.

The key-value store also gets a `SUMMARY` record: query/search counts, raw rows, how many were
removed by each filter (agency, top-company, company-size), unique postings, how many were new.

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
Actor/Task. Keep `datePosted` = `past24Hours`, and keep the niche/location combination modest
per schedule (see the runtime note above) — set up a few schedules covering different niche
subsets rather than one schedule trying to cover all fifteen niches × two countries at once.

---

## Deploy / update from GitHub

This repo is wired for Apify's GitHub integration. It's a **public** repo (no secrets in the
code) specifically so Apify's Git-source build never needs a deploy key — that flow proved
easy to misconfigure/lose via the Console UI.

- **First time**: Apify Console → **Actors** → **Develop new** → **Link Git repository** →
  paste this repo's URL. Apify reads `.actor/actor.json` and builds automatically.
- **Updates**: `git push` to the default branch, then hit **Build** in the Actor's **Source**
  tab. Double-check the **Source type** dropdown there still says "Git repository" before
  trusting a build — it has silently reverted to "Web IDE" (building generic boilerplate
  instead of this repo) before, with no obvious warning; the giveaway is a build log with no
  `ACTOR: Cloning ...` line at the top, or a run whose "Origin" column says "Web".

Local dev (optional, needs Node 18+ and the Apify CLI):

```bash
npm install
apify run -p          # runs with .actor/input_schema.json defaults, purges storage
```

## Fetching results without the Console

The `fetch-semiconductor-leads` Claude skill drives a full run → wait → CSV → summary cycle
via the Apify API/MCP tools (`call-actor`, `get-actor-run`, `get-dataset-items`), so results
can be pulled straight into a conversation instead of clicking through the Console.
