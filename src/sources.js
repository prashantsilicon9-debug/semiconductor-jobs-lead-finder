/**
 * Runs the native LinkedIn scraper across all queries and returns normalized rows.
 * Each query isolates its own failures: one bad query does not abort the pipeline.
 */

import { log } from 'apify';
import { scrapeLinkedinNiche } from './scrapers/linkedin.js';
import { mapLinkedinCard } from './normalize.js';

const QUERY_CONCURRENCY = 2;

/** Small promise pool so per-query scrapes run a few at a time. */
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

export async function runLinkedin({ queries, location, datePosted, maxJobs, fetchFullDetails, snippetLen }) {
    const rows = [];

    await mapPool(queries, QUERY_CONCURRENCY, async ({ query, niche }) => {
        try {
            const cards = await scrapeLinkedinNiche({ query, location, datePosted, maxJobs, fetchFullDetails });
            for (const card of cards) {
                rows.push(mapLinkedinCard(card, { niche, query, snippetLen }));
            }
            log.info(`LinkedIn "${query}" (${niche}) → ${cards.length} postings`);
        } catch (err) {
            log.exception(err, `LinkedIn query failed: "${query}"`);
        }
    });

    return rows;
}
