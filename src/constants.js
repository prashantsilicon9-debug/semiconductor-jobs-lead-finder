/**
 * Static configuration: niche -> search queries, the staffing-agency blocklist,
 * the large/"top" company blocklist, and LinkedIn's own company-size buckets.
 */

export const NICHE_QUERIES = {
    'DV / Verification': [
        'design verification engineer',
        'DV engineer',
        'SystemVerilog UVM',
        'formal verification engineer',
    ],
    'RTL Design': [
        'RTL design engineer',
        'RTL design engineer ASIC',
        'digital design engineer RTL',
    ],
    'Physical Design': [
        'physical design engineer',
        'place and route engineer',
        'physical design engineer ASIC',
    ],
    'STA': [
        'static timing analysis engineer',
        'STA engineer semiconductor',
        'timing closure engineer',
    ],
    'DFT': [
        'DFT engineer',
        'design for test engineer',
        'ATPG engineer',
    ],
    'Emulation': [
        'emulation engineer',
        'hardware emulation engineer',
        'Palladium emulation engineer',
    ],
    'Post-Silicon Validation': [
        'post silicon validation engineer',
        'silicon validation engineer',
        'PSV engineer',
    ],
    'ASIC': [
        'ASIC design engineer',
        'ASIC engineer',
        'ASIC verification engineer',
    ],
    'SoC': [
        'SoC design engineer',
        'SoC architect',
        'SoC integration engineer',
    ],
    'SerDes': [
        'SerDes design engineer',
        'high speed SerDes engineer',
        'SerDes PHY design engineer',
    ],
    'Photonics': [
        'silicon photonics engineer',
        'photonic IC design engineer',
        'optical engineer semiconductor',
    ],
    'Memory': [
        'memory design engineer',
        'DRAM design engineer',
        'memory controller design engineer',
    ],
    'HBM': [
        'HBM design engineer',
        'HBM verification engineer',
        'high bandwidth memory engineer',
    ],
    'NVMe': [
        'NVMe firmware engineer',
        'NVMe controller design engineer',
        'SSD firmware engineer',
    ],
    'UCIe': [
        'UCIe design engineer',
        'chiplet interconnect engineer',
        'die-to-die interface engineer',
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

/**
 * Heuristic blocklist of large, well-known employers — mega-cap tech, big
 * semiconductor/EDA, and large aerospace/defense — that almost certainly run
 * their own in-house recruiting and are not a staffing firm's target client.
 * This is a backstop, not exhaustive: it catches big names even when the live
 * employee-count lookup gets blocked (LinkedIn's guest company pages are
 * inconsistently gated — confirmed live: one small company's page loaded fine,
 * the very next request to a large company's page returned a full sign-up
 * wall instead of content). Real filtering is `maxCompanySize` below; this
 * list is the safety net for when that lookup can't get through.
 */
export const TOP_COMPANY_BLOCKLIST = [
    'google', 'alphabet', 'microsoft', 'amazon', 'aws', 'apple', 'meta platforms',
    'facebook', 'nvidia', 'intel corporation', 'intel ', 'qualcomm', 'broadcom',
    'texas instruments', 'micron technology', 'samsung', 'tsmc', 'taiwan semiconductor',
    'advanced micro devices', ' amd', 'cisco', 'ibm', 'oracle', 'salesforce', 'sap',
    'dell technologies', 'hewlett packard', 'hpe', 'lockheed martin', 'boeing',
    'raytheon', 'rtx corporation', 'northrop grumman', 'general dynamics', 'honeywell',
    'analog devices', 'marvell technology', 'skyworks', 'applied materials',
    'lam research', 'kla corporation', 'asml', 'globalfoundries', 'onsemi',
    'on semiconductor', 'stmicroelectronics', 'infineon', 'nxp semiconductors',
    'renesas', 'sony', 'panasonic', 'robert bosch', 'continental ag', 'tesla',
    'spacex', 'ford motor', 'general motors', 'netflix', 'adobe', 'vmware',
    'western digital', 'seagate', 'kioxia', 'sk hynix', 'synopsys', 'cadence',
    'siemens', 'arm holdings', 'mediatek', 'collins aerospace', 'sandia national',
    'blue origin', 'l3harris', 'leidos', 'booz allen',
];

/**
 * LinkedIn's own company-size bands (shown on every public company page) and
 * the upper bound of employees each band represents. Used to translate a
 * scraped label like "51-200 employees" into a number the size filter can compare.
 */
export const LINKEDIN_SIZE_BANDS = [
    { pattern: /\b1-10\b/, upper: 10 },
    { pattern: /\b11-50\b/, upper: 50 },
    { pattern: /\b51-200\b/, upper: 200 },
    { pattern: /\b201-500\b/, upper: 500 },
    { pattern: /\b501-1,?000\b/, upper: 1000 },
    { pattern: /\b1,?001-5,?000\b/, upper: 5000 },
    { pattern: /\b5,?001-10,?000\b/, upper: 10000 },
    { pattern: /\b10,?001\+/, upper: Infinity },
];
