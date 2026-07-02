const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const TWEET_DATA_DIR = path.join(ROOT_DIR, 'TweetData');
const RAW_DATA_DIR = path.join(TWEET_DATA_DIR, 'RawData');
const NEW_RAW_DATA_DIR = path.join(TWEET_DATA_DIR, 'NewRawData');
const LARGE_VIDEO_DIR = path.join(TWEET_DATA_DIR, 'LargeRawData');
const RAW_THREADS_DIR = path.join(TWEET_DATA_DIR, 'RawThreads');
const STATS_OUTPUT_PATH = path.join(TWEET_DATA_DIR, 'summary_stats');
const MEDIA_DIR = path.join(TWEET_DATA_DIR, 'Media');
const THREADS_OUTPUT_DIR = path.join(TWEET_DATA_DIR, 'Threads');
const THREADS_RAW_DIR = path.join(TWEET_DATA_DIR, 'ThreadsRaw');
const THREADS_MEDIA_DIR = path.join(TWEET_DATA_DIR, 'ThreadMedia');

const CONFIG_DIR = path.join(ROOT_DIR, 'Config');
const COOKIES_FILE = path.join(CONFIG_DIR, 'Cookies', 'cookies.txt');
const AUTH_FILE = path.join(CONFIG_DIR, 'Settings', 'auth.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'Settings', 'config.json');
const INSTAGRAM_CONFIG_FILE = path.join(CONFIG_DIR, 'Settings', 'instagram_config.json');
const GRAPHQL_PAYLOAD_CONFIG = path.join(CONFIG_DIR, 'Settings', 'graphql_api_payload.json');

const USERS_FILE = path.join(CONFIG_DIR, 'Users', 'users.txt');
const THREADS_QUEUE = path.join(CONFIG_DIR, 'Users', 'threads.txt');
const URLS_THREADREADER = path.join(CONFIG_DIR, 'Users', 'urls_threadreader.txt');
const URLS_TWITTERTHREAD = path.join(CONFIG_DIR, 'Users', 'urls_twitterthread.txt');
const INSTAGRAM_USERS = path.join(CONFIG_DIR, 'Users', 'instagram_users.txt');

const COMPLETED_THREADS = path.join(CONFIG_DIR, 'Queues', 'completed_threads.txt');
const FAILED_THREADS = path.join(CONFIG_DIR, 'Queues', 'failed_threads.txt');

const X_CHECK_OUTPUT = path.join(TWEET_DATA_DIR, 'AccountStatus', 'results.csv');

module.exports = {
    ROOT_DIR,
    TWEET_DATA_DIR,
    RAW_DATA_DIR,
    NEW_RAW_DATA_DIR,
    LARGE_VIDEO_DIR,
    RAW_THREADS_DIR,
    STATS_OUTPUT_PATH,
    MEDIA_DIR,
    THREADS_OUTPUT_DIR,
    THREADS_RAW_DIR,
    THREADS_MEDIA_DIR,
    CONFIG_DIR,
    COOKIES_FILE,
    AUTH_FILE,
    CONFIG_FILE,
    INSTAGRAM_CONFIG_FILE,
    GRAPHQL_PAYLOAD_CONFIG,
    USERS_FILE,
    THREADS_QUEUE,
    URLS_THREADREADER,
    URLS_TWITTERTHREAD,
    INSTAGRAM_USERS,
    COMPLETED_THREADS,
    FAILED_THREADS,
    X_CHECK_OUTPUT
};
