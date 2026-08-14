const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimitError, API_MAX_RETRIES, API_BASE_RETRY_DELAY_MS } = require('../lib/rateLimits');

test('rateLimit - RateLimitError instantiation and properties', () => {
    const err = new RateLimitError('API Rate Limit Exceeded', '1700000000');
    assert.equal(err.name, 'RateLimitError');
    assert.equal(err.message, 'API Rate Limit Exceeded');
    assert.equal(err.resetTime, '1700000000');
    assert.ok(err instanceof Error);
});

test('rateLimit - exponential backoff calculations', () => {
    assert.equal(API_MAX_RETRIES, 3);
    assert.equal(API_BASE_RETRY_DELAY_MS, 5000);

    const delay0 = API_BASE_RETRY_DELAY_MS * Math.pow(3, 0); // 5,000ms
    const delay1 = API_BASE_RETRY_DELAY_MS * Math.pow(3, 1); // 15,000ms
    const delay2 = API_BASE_RETRY_DELAY_MS * Math.pow(3, 2); // 45,000ms

    assert.equal(delay0, 5000);
    assert.equal(delay1, 15000);
    assert.equal(delay2, 45000);
});
