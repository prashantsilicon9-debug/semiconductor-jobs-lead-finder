/**
 * Runs the native LinkedIn scraper across all query x location combinations and
 * returns normalized rows, plus a best-effort company-size enrichment pass.
 *
 * Search requests run fully sequentially with a pause between each — confirmed
 * live that LinkedIn's guest endpoints get inconsistently gated (a page that
 * loads fine one moment can return a login wall the very next request), so
 * pacing favors getting through over speed. One bad query/location does not
 * abort the pipeline; it just contributes zero rows and gets logged.
 */

import { log } from 'apify';
import { scrapeLinkedinNiche, fetchCompanySize } from './scrapers/linkedin.js';
import { mapLinkedinCard } from './normalize.js';

const INTER_TASK_DELAY_MS = 1500;
const DETAIL_CONCURRENCY = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Small concurrency-limited pool (used only for the lighter company-size lookups). */
async function mapPool(items, concurrency, fn) {
    const entries = [...items.entries()];
    const results = [];
    const worker = async () => {
        while (entries.length) {
            const [i, item] = entries.shift();
            results[i] = await fn(item);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
    return results;
}

export async function runLinkedin({ queries, locations, datePosted, maxJobs, fetchFullDetails, snippetLen }) {
    const rows = [];
    const locs = Array.isArray(locations) && locations.length ? locations : [''];
    const tasks = [];
    for (const { query, niche } of queries) {
        for (const location of locs) {
            tasks.push({ query, niche, location });
        }
    }

    log.info(`LinkedIn: ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} × `
        + `${locs.length} location${locs.length === 1 ? '' : 's'} = ${tasks.length} searches (sequential, paced)`);

    for (let i = 0; i < tasks.length; i++) {
        const { query, niche, location } = tasks[i];
        try {
            const cards = await scrapeLinkedinNiche({ query, location, datePosted, maxJobs, fetchFullDetails });
            for (const card of cards) rows.push(mapLinkedinCard(card, { niche, query, snippetLen, searchLocation: location }));
            log.info(`LinkedIn "${query}" @ ${location || 'default'} (${niche}) → ${cards.length} postings`);
        } catch (err) {
            log.exception(err, `LinkedIn query failed: "${query}" @ ${location || 'default'}`);
        }
        if (i < tasks.length - 1) await sleep(INTER_TASK_DELAY_MS);
    }

    return rows;
}

/**
 * Best-effort company-size lookup for a set of rows, mutating each row's
 * company_size_label / company_size_upper in place. Runs once per unique
 * company (not per row) to keep the extra request volume down. Never drops a
 * row itself — filtering on the result is the caller's job — because a failed
 * lookup means "unknown," not "large."
 */
export async function enrichCompanySizes(rows) {
    const byCompany = new Map();
    for (const row of rows) {
        const key = row.company_linkedin_url || row.company;
        if (!key) continue;
        if (!byCompany.has(key)) byCompany.set(key, []);
        byCompany.get(key).push(row);
    }

    const uniqueCompanies = [...byCompany.entries()].filter(([, group]) => group[0].company_linkedin_url);
    log.info(`Looking up company size for ${uniqueCompanies.length} unique companies`);

    await mapPool(uniqueCompanies, DETAIL_CONCURRENCY, async ([, group]) => {
        const size = await fetchCompanySize(group[0].company_linkedin_url);
        if (!size) return;
        for (const row of group) {
            row.company_size_label = size.label;
            row.company_size_upper = size.upper;
        }
    });

    return rows;
}
