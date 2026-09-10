/**
 * Static configuration: niche -> search queries, source Actor ids,
 * date-window mapping per source, and the staffing-agency blocklist.
 */

export const NICHE_QUERIES = {
    'DV / Verification': [
        'design verification engineer',
        'DV engineer',
        'SystemVerilog UVM',
        'formal verification engineer',
    ],
    'RTL / PD / STA': [
        'RTL design engineer',
        'physical design engineer',
        'static timing analysis engineer',
        'place and route engineer',
    ],
    'SerDes / Photonics': [
        'SerDes design engineer',
        'silicon photonics engineer',
        'high speed SerDes engineer',
        'mixed signal design engineer',
    ],
};

export const SOURCE_ACTORS = {
    indeed: 'borderline/indeed-scraper',
    linkedin: 'curious_coder/linkedin-jobs-scraper',
    google_jobs: 'gio21/google-jobs-scraper',
};

/** Higher number = richer record, wins as the base row when merging duplicates. */
export const SOURCE_RANK = {
    linkedin: 3,
    indeed: 2,
    google_jobs: 1,
};

/** Our `datePosted` input value -> the value each child Actor expects. */
export const DATE_POSTED_MAP = {
    past24Hours: { indeed: '1', linkedin: 'past24Hours', google: 'today' },
    past3Days: { indeed: '3', linkedin: 'pastWeek', google: '3days' },
    pastWeek: { indeed: '7', linkedin: 'pastWeek', google: 'week' },
};

/** Rough per-result cost (USD) of each child Actor, for the advisory budget log. */
export const SOURCE_UNIT_COST = {
    indeed: 0.005,
    linkedin: 0.001,
    google_jobs: 0.003,
};

/**
 * Substrings that mark a "company" as a staffing firm / recruiter / body shop
 * rather than a real end client. Case-insensitive substring match on company name.
 */
export const STAFFING_AGENCY_KEYWORDS = [
    'staffing',
    'recruit',
    'recruiter',
    'recruiting',
    'recruitment',
    'talent solutions',
    'talent group',
    'talent partners',
    'talent acquisition',
    'resourcing',
    'staff aug',
    'staffing solutions',
    'workforce solutions',
    'consulting services',
    'consultants',
    'it consulting',
    'technology partners',
    'teksystems',
    'tek systems',
    'robert half',
    'randstad',
    'aerotek',
    'apex systems',
    'insight global',
    'kforce',
    'collabera',
    'mindlance',
    'cybercoders',
    'jobot',
    'dice careers',
    'hays',
    'manpower',
    'adecco',
    'experis',
    'judge group',
    'system one',
    'net2source',
    'artech',
    'pyramid consulting',
    'us tech solutions',
    'compunnel',
    'diverse lynx',
    'infojini',
    'vdart',
    'akkodis',
    'motion recruitment',
    'oscar associates',
    'harnham',
    'mrinetwork',
    'the judge',
];
