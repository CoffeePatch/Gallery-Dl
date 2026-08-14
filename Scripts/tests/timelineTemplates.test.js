const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../lib/paths');

test('timelineTemplates - template files exist and are non-empty', () => {
    const cssPath = path.join(ROOT_DIR, 'Scripts', 'templates', 'timeline.css');
    const htmlPath = path.join(ROOT_DIR, 'Scripts', 'templates', 'timeline.html');

    assert.ok(fs.existsSync(cssPath), 'timeline.css should exist');
    assert.ok(fs.existsSync(htmlPath), 'timeline.html should exist');

    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(cssContent.includes('.container'), 'timeline.css should contain .container styles');
    assert.ok(htmlContent.includes('{{STYLES}}'), 'timeline.html should contain {{STYLES}} placeholder');
});
