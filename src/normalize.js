/**
 * Turns raw LinkedIn card/detail data into one flat, consistent row shape,
 * plus the helpers used for dedup and filtering.
 */

import { createHash } from 'node:crypto';
import { STAFFING_AGENCY_KEYWORDS } from './constants.js';

export const clean = (value) => (typeof value === 'string' ? value.trim() : (value == null ? '' : String(value)));

export const truncate = (value, max) => {
    const text = clean(value).replace(/\s+/g, ' ').trim();
    if (max == null || max < 0) return text;
    if (max === 0) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max).trim()}…`;
};

const firstCity = (location) => clean(location).split(',')[0].trim();

/** Best-effort work-type classification from any free text we have. */
export function detectWorkType(...texts) {
    const hay = texts.map((t) => clean(t).toLowerCase()).join(' ');
    if (/\bhybrid\b/.test(hay)) return 'hybrid';
    if (/\b(remote|work from home|wfh|telecommute|telework|fully distributed)\b/.test(hay)) return 'remote';
    if (/\bon-?site\b/.test(hay)) return 'onsite';
    return '';
}

export function isStaffingAgency(company, extra = []) {
    const name = clean(company).toLowerCase();
    if (!name) return false;
    const list = [...STAFFING_AGENCY_KEYWORDS, ...extra.map((e) => clean(e).toLowerCase()).filter(Boolean)];
    return list.some((kw) => name.includes(kw));
}

export function matchesExcluded(company, extra = []) {
    const name = clean(company).toLowerCase();
    if (!name) return false;
    return extra.map((e) => clean(e).toLowerCase()).filter(Boolean).some((kw) => name.includes(kw));
}

/** Convert absolute dates OR relative strings ("3 days ago", "Just posted") to YYYY-MM-DD. */
export function toIsoDate(value) {
    if (!value) return '';
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(String(value))) {
        return direct.toISOString().slice(0, 10);
    }
    const s = String(value).toLowerCase();
    const now = new Date();
    if (/just posted|just now|today|hour|minute|moments? ago/.test(s)) {
        return now.toISOString().slice(0, 10);
    }
    if (/yesterday/.test(s)) {
        now.setDate(now.getDate() - 1);
        return now.toISOString().slice(0, 10);
    }
    const m = s.match(/(\d+)\+?\s*(day|week|month)/);
    if (m) {
        const n = parseInt(m[1], 10);
        const mult = m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1;
        now.setDate(now.getDate() - n * mult);
        return now.toISOString().slice(0, 10);
    }
    return Number.isNaN(direct.getTime()) ? '' : direct.toISOString().slice(0, 10);
}

/** Stable identity for a posting so "new vs seen" survives across runs and repeated queries. */
export function makeDedupeKey(company, title, location) {
    const parts = [company, title, firstCity(location)].map((p) =>
        clean(p).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    if (parts.every((p) => !p)) return '';
    return parts.join(' | ');
}

export function sha1(text) {
    return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function emptyRow(overrides) {
    return {
        niche: '',
        search_query: '',
        source: 'linkedin',
        job_title: '',
        company: '',
        location: '',
        work_type: '',
        employment_type: '',
        industry: '',
        posted_date: '',
        salary: '',
        apply_url: '',
        job_description_snippet: '',
        company_linkedin_url: '',
        job_id: '',
        stable_id: '',
        dedupe_key: '',
        is_new: true,
        first_seen: '',
        date_scraped: '',
        ...overrides,
    };
}

function finalize(row, { snippetLen }) {
    row.job_description_snippet = truncate(row.job_description_snippet, snippetLen);
    row.dedupe_key = makeDedupeKey(row.company, row.job_title, row.location);
    row.stable_id = row.dedupe_key ? `k:${sha1(row.dedupe_key)}` : `j:${sha1(row.job_id || JSON.stringify(row))}`;
    return row;
}

/** Map one scraped LinkedIn job card (optionally enriched with detail-page fields) to a row. */
export function mapLinkedinCard(card, { niche, query, snippetLen }) {
    const location = clean(card.detailLocation || card.location);
    const row = emptyRow({
        niche,
        search_query: query,
        job_title: clean(card.title),
        company: clean(card.company),
        location,
        work_type: detectWorkType(card.title, location, card.employmentType, card.descriptionText),
        employment_type: clean(card.employmentType),
        industry: clean(card.industry),
        posted_date: toIsoDate(card.postedIso || card.postedRelative),
        salary: clean(card.salary),
        apply_url: clean(card.link),
        job_description_snippet: clean(card.descriptionText),
        company_linkedin_url: clean(card.companyLinkedinUrl || card.companyUrl),
        job_id: `linkedin:${clean(card.id) || clean(card.link)}`,
    });
    if (!row.work_type) row.work_type = 'onsite';
    return finalize(row, { snippetLen });
}
