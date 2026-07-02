// Rate limiting constants referenced by scraping limits documentation (twitter_scraping_limits.md)
module.exports = {
    // delay between individual media downloads to respect rate-limiting
    MEDIA_DOWNLOAD_DELAY_MS: 500,

    // delay between successive account checks to mimic human navigation and prevent temp blocks
    X_CHECKER_NAV_DELAY_MS: 2000,
    X_CHECKER_PACING_MIN_MS: 3000,
    X_CHECKER_PACING_MAX_MS: 6000,
    X_CHECKER_POLL_DELAY_MS: 1000,
    X_CHECKER_BATCH_WAIT_MS: 15 * 60 * 1000, // 15 minutes batch limit reset

    // delays used in thread manager strategy B & C scrolling / wait operations
    THREAD_NAV_LOAD_DELAY_MS: 5000,
    THREAD_PACING_MIN_MS: 4000,
    THREAD_PACING_MAX_MS: 8000
};
