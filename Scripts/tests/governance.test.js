const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../lib/paths');

test('repository governance - no JS files at repository root', () => {
    const rootFiles = fs.readdirSync(ROOT_DIR);
    const rootJsFiles = rootFiles.filter(file => file.endsWith('.js'));
    
    assert.deepStrictEqual(
        rootJsFiles,
        [],
        `Root directory contains unmanaged JS files: ${rootJsFiles.join(', ')}. All scripts must reside in Scripts/ or its subdirectories per CONTRIBUTING.md.`
    );
});
