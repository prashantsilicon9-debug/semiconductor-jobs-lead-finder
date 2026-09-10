import { Actor, log } from 'apify';
import {
    NICHE_QUERIES,
    SOURCE_RANK,
    SOURCE_UNIT_COST,
} from './constants.js';
import { isStaffingAgency, matchesExcluded } from './normalize.js';
import { runIndeed, runLinkedin, runGoogle } from './sources.js';

const SEEN_STORE_KEY = 'SEEN_JOBS';
const SEEN_TTL_DAYS = 60;

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    niches = Object.keys(NICHE_QUERIES),
    customQueries = [],
    sources = ['indeed', 'linkedin', 'google_jobs'],
    location = '',
    countryCode = 'us',
    datePosted = 'past24Hours',
    maxJobsPerQueryPerSource = 60,
    googleMaxItems = 200,
    excludeStaffingAgencies = true,
    extraExcludeCompanies = [],
    onlyNewSinceLastRun = false,
    descriptionSnippetLength = 300,
    dailyBudgetUsd = 3,
    googleSheetUrl = '',
    proxyConfiguration = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
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
    await Actor.fail('No search queries to run — select at least one niche or add custom queries.');
}

log.info('Run configuration', {
    niches, sourceCount: sources.length, queryCount: queries.length,
    location: location || 'nationwide', datePosted, maxJobsPerQueryPerSource, googleMaxItems,
    googleSheetUrl: googleSheetUrl || '(configure via Apify → Google Sheets integration)',
});

/* ----------------------- projected-cost warning ---------------------- */

let projected = 0;
if (sources.includes('indeed')) projected += queries.length * maxJobsPerQueryPerSource * SOURCE_UNIT_COST.indeed;
if (sources.includes('linkedin')) projected += queries.length * maxJobsPerQueryPerSource * SOURCE_UNIT_COST.linkedin;
if (sources.includes('google_jobs')) projected += googleMaxItems * SOURCE_UNIT_COST.google_jobs;
log.info(`Projected worst-case child-Actor cost this run: ~$${projected.toFixed(2)} (budget $${dailyBudgetUsd})`);
if (dailyBudgetUsd && projected > dailyBudgetUsd) {
    log.warning(`Projected cost ~$${projected.toFixed(2)} exceeds daily budget $${dailyBudgetUsd}. `
        + 'Lower maxJobsPerQueryPerSource / googleMaxItems, drop a source, or narrow the niches.');
}

/* --------------------------- run the sources -------------------------- */

const tasks = [];
if (sources.includes('indeed')) {
    tasks.push(['indeed', runIndeed({
        queries, location, countryCode, datePosted,
        maxJobs: maxJobsPerQueryPerSource, snippetLen: descriptionSnippetLength,
    })]);
}
if (sources.includes('linkedin')) {
    tasks.push(['linkedin', runLinkedin({
        queries, location, datePosted,
        maxJobs: maxJobsPerQueryPerSource, snippetLen: descriptionSnippetLength,
    })]);
}
if (sources.includes('google_jobs')) {
    tasks.push(['google_jobs', runGoogle({
        queries, location, countryCode, datePosted,
        maxItems: googleMaxItems, snippetLen: descriptionSnippetLength, proxyConfiguration,
    })]);
}

const settled = await Promise.allSettled(tasks.map(([, promise]) => promise));

const rawRows = [];
const perSourceCounts = {};
settled.forEach((result, i) => {
    const name = tasks[i][0];
    if (result.status === 'fulfilled') {
        perSourceCounts[name] = result.value.length;
        rawRows.push(...result.value);
    } else {
        perSourceCounts[name] = `ERROR: ${result.reason?.message || result.reason}`;
        log.exception(result.reason, `Source ${name} rejected`);
    }
});
log.info('Raw rows per source', perSourceCounts);

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
        byKey.set(key, { ...row, sources_seen: row.source });
        continue;
    }
    const rowRank = SOURCE_RANK[row.source] || 0;
    const existingRank = SOURCE_RANK[existing.source] || 0;
    const [primary, secondary] = rowRank >= existingRank ? [row, existing] : [existing, row];
    const merged = { ...secondary, ...stripBlanks(primary) };
    merged.source = primary.source;
    merged.sources_seen = [...new Set(
        `${existing.sources_seen},${row.source}`.split(',').map((s) => s.trim()).filter(Boolean),
    )].join(', ');
    byKey.set(key, merged);
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
    delete row.posted_via;
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
    sourcesUsed: sources,
    rawPerSource: perSourceCounts,
    removedByAgencyFilter: removedByFilter,
    uniquePostings: deduped.length,
    newSinceLastRun: newCount,
    rowsWritten: output.length,
    projectedChildCostUsd: Number(projected.toFixed(2)),
    byNiche: deduped.reduce((acc, r) => { acc[r.niche] = (acc[r.niche] || 0) + 1; return acc; }, {}),
};
await Actor.setValue('SUMMARY', summary);
log.info('Run summary', summary);

await Actor.exit();
