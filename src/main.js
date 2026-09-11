import { Actor, log } from 'apify';
import { NICHE_QUERIES } from './constants.js';
import { isStaffingAgency, matchesExcluded } from './normalize.js';
import { runLinkedin } from './sources.js';

const SEEN_STORE_KEY = 'SEEN_JOBS';
const SEEN_TTL_DAYS = 60;

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    niches = Object.keys(NICHE_QUERIES),
    customQueries = [],
    location = '',
    datePosted = 'past24Hours',
    maxJobsPerQuery = 25,
    fetchFullDetails = true,
    excludeStaffingAgencies = true,
    extraExcludeCompanies = [],
    onlyNewSinceLastRun = false,
    descriptionSnippetLength = 300,
    googleSheetUrl = '',
} = input;

/* ------------------------ build the query list ------------------------ */

let queries = [];
if (Array.isArray(customQueries) && customQueries.filter(Boolean).length) {
    queries = customQueries.filter(Boolean).map((query) => ({ query: query.trim(), niche: 'Custom' }));
} else {
    for (const niche of niches) {
        for (const query of (NICHE_QUERIES[niche] || [])) {
            queries.push({ query, niche });
        }
    }
}

if (!queries.length) {
    await Actor.exit({ exitCode: 1, statusMessage: 'No search queries — select at least one niche or add custom queries.' });
}

log.info('Run configuration', {
    niches, queryCount: queries.length, location: location || 'United States',
    datePosted, maxJobsPerQuery, fetchFullDetails,
    googleSheetUrl: googleSheetUrl || '(configure via Apify → Google Sheets integration)',
});

/* --------------------------- scrape LinkedIn --------------------------- */

const rawRows = await runLinkedin({
    queries, location, datePosted, maxJobs: maxJobsPerQuery, fetchFullDetails,
    snippetLen: descriptionSnippetLength,
});
log.info(`Raw rows: ${rawRows.length}`);

/* ----------------------------- filtering ----------------------------- */

let rows = rawRows.filter((r) => r.job_title && r.company);

const beforeFilter = rows.length;
if (excludeStaffingAgencies) {
    rows = rows.filter((r) => !isStaffingAgency(r.company, extraExcludeCompanies));
} else if (extraExcludeCompanies.length) {
    rows = rows.filter((r) => !matchesExcluded(r.company, extraExcludeCompanies));
}
const removedByFilter = beforeFilter - rows.length;

/* --------------------------- dedupe + merge -------------------------- */

const stripBlanks = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));

const byKey = new Map();
for (const row of rows) {
    const key = row.stable_id;
    const existing = byKey.get(key);
    if (!existing) {
        byKey.set(key, row);
        continue;
    }
    // Same posting surfaced by more than one query — keep whichever has richer data.
    byKey.set(key, { ...existing, ...stripBlanks(row) });
}
let deduped = [...byKey.values()];
log.info(`Deduped ${rows.length} → ${deduped.length} unique postings`);

/* --------------------- new-vs-seen against KV store ------------------ */

const store = await Actor.openKeyValueStore();
const seen = (await store.getValue(SEEN_STORE_KEY)) || {};
const runDate = new Date().toISOString().slice(0, 10);
const cutoff = Date.now() - SEEN_TTL_DAYS * 86_400_000;

let newCount = 0;
for (const row of deduped) {
    const firstSeen = seen[row.stable_id];
    row.is_new = !firstSeen;
    row.first_seen = firstSeen || runDate;
    row.date_scraped = runDate;
    if (!firstSeen) {
        seen[row.stable_id] = runDate;
        newCount += 1;
    }
    delete row.dedupe_key;
    delete row.job_id;
}

for (const [id, date] of Object.entries(seen)) {
    if (new Date(date).getTime() < cutoff) delete seen[id];
}
await store.setValue(SEEN_STORE_KEY, seen);

/* ------------------------------ sort -------------------------------- */

const workRank = { remote: 0, hybrid: 1, onsite: 2, '': 3 };
deduped.sort((a, b) =>
    Number(b.is_new) - Number(a.is_new)
    || (b.posted_date || '').localeCompare(a.posted_date || '')
    || (a.niche || '').localeCompare(b.niche || '')
    || (a.company || '').localeCompare(b.company || '')
    || (workRank[a.work_type] ?? 3) - (workRank[b.work_type] ?? 3));

/* ----------------------------- output ------------------------------ */

const output = onlyNewSinceLastRun ? deduped.filter((r) => r.is_new) : deduped;
await Actor.pushData(output);

const summary = {
    runDate,
    queriesRun: queries.length,
    rawRows: rawRows.length,
    removedByAgencyFilter: removedByFilter,
    uniquePostings: deduped.length,
    newSinceLastRun: newCount,
    rowsWritten: output.length,
    byNiche: deduped.reduce((acc, r) => { acc[r.niche] = (acc[r.niche] || 0) + 1; return acc; }, {}),
};
await Actor.setValue('SUMMARY', summary);
log.info('Run summary', summary);

await Actor.exit();
