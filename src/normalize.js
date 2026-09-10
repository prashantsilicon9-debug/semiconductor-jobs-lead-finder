/**
 * Turns the wildly different outputs of the three child Actors into one flat,
 * consistent row shape, plus the helpers used for dedup and filtering.
 */

import { createHash } from 'node:crypto';
import { STAFFING_AGENCY_KEYWORDS } from './constants.js';

export const clean = (value) => (typeof value === 'string' ? value.trim() : (value == null ? '' : String(value)));

export const truncate = (value, max) => {
    const text = clean(value).replace(/\s+/g, ' ').trim();
    if (!max || text.length <= max) return text;
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

/** Stable identity for a posting so "new vs seen" survives across runs and sources. */
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
        source: '',
        sources_seen: '',
        job_title: '',
        company: '',
        company_website: '',
        location: '',
        work_type: '',
        posted_date: '',
        salary: '',
        apply_url: '',
        job_description_snippet: '',
        job_poster_name: '',
        job_poster_title: '',
        company_linkedin_url: '',
        company_size: '',
        posted_via: '',
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
    if (!row.sources_seen) row.sources_seen = row.source;
    return row;
}

/* --------------------------- per-source mappers --------------------------- */

export function mapIndeed(item, { niche, query, snippetLen }) {
    const company = clean(item.companyName);
    const row = emptyRow({
        niche,
        search_query: query,
        source: 'indeed',
        job_title: clean(item.title),
        company,
        company_website: clean(item.companyLinks?.corporateWebsite || item.companyUrl),
        location: clean(item.location?.formattedAddressShort || item.location?.fullAddress || item.location?.city),
        work_type: item.isRemote ? 'remote' : detectWorkType(item.title, item.descriptionText),
        posted_date: toIsoDate(item.datePublished || item.age),
        salary: clean(item.salary?.salaryText),
        apply_url: clean(item.applyUrl || item.jobUrl),
        job_description_snippet: clean(item.descriptionText),
        company_size: clean(item.companyNumEmployees),
        job_id: `indeed:${clean(item.jobKey) || clean(item.jobUrl)}`,
    });
    if (!row.work_type) row.work_type = 'onsite';
    return finalize(row, { snippetLen });
}

export function mapLinkedin(item, { niche, query, snippetLen }) {
    const company = clean(item.companyName);
    const row = emptyRow({
        niche,
        search_query: query,
        source: 'linkedin',
        job_title: clean(item.title),
        company,
        company_website: clean(item.companyWebsite),
        location: clean(item.location),
        work_type: detectWorkType(item.title, item.location, item.employmentType, item.descriptionText),
        posted_date: toIsoDate(item.postedAt),
        salary: clean(item.salary),
        apply_url: clean(item.applyUrl || item.link),
        job_description_snippet: clean(item.descriptionText),
        job_poster_name: clean(item.jobPosterName),
        job_poster_title: clean(item.jobPosterTitle),
        company_linkedin_url: clean(item.companyLinkedinUrl),
        company_size: item.companyEmployeesCount ? String(item.companyEmployeesCount) : '',
        job_id: `linkedin:${clean(item.id) || clean(item.link)}`,
    });
    if (!row.work_type) row.work_type = 'onsite';
    return finalize(row, { snippetLen });
}

export function mapGoogle(item, { niche, snippetLen }) {
    const company = clean(item.companyName);
    const applyOptions = Array.isArray(item.applyOptions) ? item.applyOptions : [];
    const preferred = applyOptions.find((o) =>
        /company|greenhouse|lever|workday|ashby|icims|smartrecruiters|bamboo/i.test(clean(o.network)));
    const salary = (item.salaryMin || item.salaryMax)
        ? `${clean(item.salaryCurrency)}${[item.salaryMin, item.salaryMax].filter(Boolean).join('–')}`
            + `${item.salaryPeriod ? `/${clean(item.salaryPeriod).toLowerCase()}` : ''}`
        : '';
    const row = emptyRow({
        niche,
        search_query: clean(item.sourceQuery || item.query),
        source: 'google_jobs',
        job_title: clean(item.title),
        company,
        location: clean(item.location),
        work_type: item.workFromHome ? 'remote' : detectWorkType(item.title, item.location, item.description),
        posted_date: toIsoDate(item.postedAtIso || item.postedAt),
        salary: salary.trim(),
        apply_url: clean(preferred?.url || applyOptions[0]?.url || item.url),
        job_description_snippet: clean(item.description),
        posted_via: clean(item.postedVia),
        job_id: `google:${clean(item.jobId) || clean(item.url)}`,
    });
    if (!row.work_type) row.work_type = 'onsite';
    return finalize(row, { snippetLen });
}
