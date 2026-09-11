/**
 * Native LinkedIn Jobs scraper. No login, no third-party Actor dependency.
 *
 * Two endpoints are used:
 *  1. The public "guest" search API — returns paginated HTML fragments of job
 *     cards. Verified live: stable class names (base-search-card__title etc.),
 *     exact ISO posted-dates, no login required.
 *  2. Individual job view pages — each embeds a schema.org JobPosting JSON-LD
 *     block (LinkedIn publishes this on purpose, for Google Jobs indexing),
 *     which gives a real description, salary, industry and employment type
 *     far more reliably than scraping the visible page markup.
 */

import * as cheerio from 'cheerio';
import { log } from 'apify';

const GUEST_SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGE_SIZE = 25;
const MAX_START = 975; // LinkedIn's guest search stops returning new pages well before this
const PAGE_DELAY_MS = 700;
const DETAIL_CONCURRENCY = 3;
const DETAIL_TIMEOUT_MS = 15_000;

const TPR_MAP = { past24Hours: 'r86400', past3Days: 'r259200', pastWeek: 'r604800' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(str) {
    if (!str) return '';
    return str
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, '\'')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&amp;/g, '&');
}

function htmlToText(html) {
    if (!html) return '';
    const $ = cheerio.load(`<div>${decodeEntities(html)}</div>`);
    return $('div').text().replace(/\s+/g, ' ').trim();
}

async function fetchText(url, timeoutMs = 20_000) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

function parseSearchCards(html) {
    const $ = cheerio.load(html);
    const cards = [];
    $('li').each((_, li) => {
        const $li = $(li);
        const $base = $li.find('div.base-card').first();
        if (!$base.length) return;
        const urn = $base.attr('data-entity-urn') || '';
        const idMatch = urn.match(/jobPosting:(\d+)/);
        const id = idMatch ? idMatch[1] : '';
        const link = ($li.find('a.base-card__full-link').attr('href') || '').split('?')[0];
        const title = $li.find('h3.base-search-card__title').text().trim();
        const $companyLink = $li.find('h4.base-search-card__subtitle a');
        const company = $companyLink.text().trim();
        const companyUrl = ($companyLink.attr('href') || '').split('?')[0];
        const location = $li.find('span.job-search-card__location').text().trim();
        const $time = $li.find('time').first();
        const postedIso = $time.attr('datetime') || '';
        const postedRelative = $time.text().trim();
        if (!title || !company) return;
        cards.push({ id, link, title, company, companyUrl, location, postedIso, postedRelative });
    });
    return cards;
}

/** Page through the guest search API for one query. */
async function searchJobs({ query, location, datePosted, maxJobs }) {
    const tpr = TPR_MAP[datePosted] || TPR_MAP.past24Hours;
    const seen = new Set();
    const results = [];
    let start = 0;
    let consecutiveEmpty = 0;

    while (results.length < maxJobs && start <= MAX_START && consecutiveEmpty < 2) {
        const params = new URLSearchParams({
            keywords: query,
            location: location || 'United States',
            start: String(start),
            f_TPR: tpr,
        });
        let html;
        try {
            html = await fetchText(`${GUEST_SEARCH_URL}?${params.toString()}`);
        } catch (err) {
            log.warning(`LinkedIn search failed for "${query}" @ start=${start}: ${err.message}`);
            break;
        }

        const cards = parseSearchCards(html);
        consecutiveEmpty = cards.length ? 0 : consecutiveEmpty + 1;

        for (const card of cards) {
            const key = card.id || card.link;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            results.push(card);
            if (results.length >= maxJobs) break;
        }

        start += PAGE_SIZE;
        if (results.length < maxJobs && start <= MAX_START) await sleep(PAGE_DELAY_MS);
    }

    return results;
}

/** Fetch one job's page and extract its schema.org JobPosting JSON-LD block. */
async function fetchJobDetail(link) {
    const html = await fetchText(link, DETAIL_TIMEOUT_MS);
    const $ = cheerio.load(html);
    let jobPosting = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        if (jobPosting) return;
        try {
            const data = JSON.parse($(el).contents().text());
            if (data && data['@type'] === 'JobPosting') jobPosting = data;
        } catch {
            // not valid/relevant JSON-LD — skip
        }
    });
    return jobPosting;
}

function salaryFromJsonLd(jobPosting) {
    const amount = jobPosting?.baseSalary?.value;
    if (!amount) return '';
    const { minValue, maxValue, value, unitText } = amount;
    const numbers = [minValue, maxValue].filter((n) => typeof n === 'number');
    const single = typeof value === 'number' ? [value] : [];
    const parts = numbers.length ? numbers : single;
    if (!parts.length) return '';
    const currency = jobPosting.baseSalary.currency || '';
    const range = parts.join('–');
    const period = unitText ? `/${String(unitText).toLowerCase()}` : '';
    return `${currency}${range}${period}`;
}

/** Small concurrency-limited pool. */
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

/**
 * Enrich search-card rows with detail-page data in place. Best-effort: a row
 * whose detail fetch fails simply keeps its search-card-only fields.
 */
async function enrichWithDetails(cards) {
    await mapPool(cards, DETAIL_CONCURRENCY, async (card) => {
        try {
            const jobPosting = await fetchJobDetail(card.link);
            if (!jobPosting) return;
            card.descriptionText = htmlToText(jobPosting.description);
            card.employmentType = jobPosting.employmentType || '';
            card.industry = jobPosting.industry || '';
            card.salary = salaryFromJsonLd(jobPosting);
            card.companyLinkedinUrl = jobPosting.hiringOrganization?.sameAs || card.companyUrl;
            if (jobPosting.datePosted) card.postedIso = jobPosting.datePosted.slice(0, 10);
            const loc = jobPosting.jobLocation?.address;
            if (loc) {
                card.detailLocation = [loc.addressLocality, loc.addressRegion, loc.addressCountry]
                    .filter(Boolean).join(', ');
            }
        } catch (err) {
            log.debug(`LinkedIn detail fetch failed for ${card.link}: ${err.message}`);
        }
    });
    return cards;
}

export async function scrapeLinkedinNiche({ query, location, datePosted, maxJobs, fetchFullDetails }) {
    const cards = await searchJobs({ query, location, datePosted, maxJobs });
    if (fetchFullDetails && cards.length) await enrichWithDetails(cards);
    return cards;
}
