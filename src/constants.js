/**
 * Static configuration: niche -> search queries, and the staffing-agency blocklist.
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
