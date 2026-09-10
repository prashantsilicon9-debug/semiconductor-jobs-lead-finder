/**
 * Calls the three child Store Actors and returns normalized rows.
 * Each source isolates its own failures: one bad child run does not abort the pipeline.
 */

import { Actor, log } from 'apify';
import { SOURCE_ACTORS, DATE_POSTED_MAP } from './constants.js';
import { clean, mapIndeed, mapLinkedin, mapGoogle } from './normalize.js';

const CHILD_RUN_TIMEOUT_SECS = 1200;

/** Run a child Actor and page through its default dataset. */
async function callActorAndFetch(actorId, input, hardLimit) {
    log.info(`→ calling ${actorId}`, { input });
    const run = await Actor.call(actorId, input, { timeout: CHILD_RUN_TIMEOUT_SECS });

    if (!run) throw new Error(`${actorId}: no run object returned`);
    if (run.status !== 'SUCCEEDED') {
        log.warning(`${actorId} finished with status ${run.status} (run ${run.id}) — using whatever it produced`);
    }

    const client = Actor.newClient();
    const dataset = client.dataset(run.defaultDatasetId);
    const out = [];
    let offset = 0;
    const pageSize = 1000;
    while (out.length < hardLimit) {
        const { items } = await dataset.listItems({ offset, limit: pageSize });
        if (!items.length) break;
        out.push(...items);
        offset += items.length;
        if (items.length < pageSize) break;
    }
    log.info(`← ${actorId} returned ${out.length} raw items`);
    return out.slice(0, hardLimit);
}

/** Small promise pool so per-query calls run a few at a time. */
async function mapPool(items, concurrency, fn) {
    const results = [];
    const entries = [...items.entries()];
    const worker = async () => {
        while (entries.length) {
            const [index, item] = entries.shift();
            results[index] = await fn(item, index);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
    return results;
}

/* -------------------------------- Indeed -------------------------------- */

export async function runIndeed({ queries, location, countryCode, datePosted, maxJobs, snippetLen }) {
    const rows = [];
    const fromDays = DATE_POSTED_MAP[datePosted]?.indeed;

    await mapPool(queries, 2, async ({ query, niche }) => {
        const input = {
            country: countryCode || 'us',
            query,
            maxRows: maxJobs,
            sort: 'date',
            enableUniqueJobs: true,
            includeSimilarJobs: false,
        };
        if (location) input.location = location;
        if (fromDays) input.fromDays = fromDays;

        try {
            const items = await callActorAndFetch(SOURCE_ACTORS.indeed, input, maxJobs * 2);
            for (const item of items) {
                if (item?.error) continue;
                rows.push(mapIndeed(item, { niche, query, snippetLen }));
            }
        } catch (err) {
            log.exception(err, `Indeed query failed: "${query}"`);
        }
    });

    return rows;
}

/* ------------------------------- LinkedIn ------------------------------- */

export async function runLinkedin({ queries, location, datePosted, maxJobs, snippetLen }) {
    const rows = [];
    const datePostedValue = DATE_POSTED_MAP[datePosted]?.linkedin || 'past24Hours';

    await mapPool(queries, 2, async ({ query, niche }) => {
        const input = {
            keywords: query,
            location: location || 'United States',
            datePosted: datePostedValue,
            autoConvertToAiSearch: true,
            scrapeCompany: true,
            limitPerSource: maxJobs,
        };

        try {
            const items = await callActorAndFetch(SOURCE_ACTORS.linkedin, input, maxJobs * 2);
            for (const item of items) {
                if (!item?.title && !item?.companyName) continue;
                rows.push(mapLinkedin(item, { niche, query, snippetLen }));
            }
        } catch (err) {
            log.exception(err, `LinkedIn query failed: "${query}"`);
        }
    });

    return rows;
}

/* ----------------------------- Google Jobs ----------------------------- */

export async function runGoogle({ queries, location, countryCode, datePosted, maxItems, snippetLen, proxyConfiguration }) {
    const queryToNiche = new Map(queries.map(({ query, niche }) => [query.toLowerCase(), niche]));
    const uniqueQueries = [...new Set(queries.map(({ query }) => query))];

    const input = {
        queries: uniqueQueries,
        countryCode: countryCode || 'us',
        languageCode: 'en',
        maxItems,
        datePosted: DATE_POSTED_MAP[datePosted]?.google || 'today',
        proxyConfiguration,
    };
    if (location) input.location = location;

    try {
        const items = await callActorAndFetch(SOURCE_ACTORS.google_jobs, input, maxItems * 2);
        const rows = [];
        for (const item of items) {
            if (!item?.title && !item?.companyName) continue;
            const q = clean(item.sourceQuery || item.query).toLowerCase();
            rows.push(mapGoogle(item, { niche: queryToNiche.get(q) || 'Unmatched', snippetLen }));
        }
        return rows;
    } catch (err) {
        log.exception(err, 'Google Jobs run failed');
        return [];
    }
}
