const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const THREADS_DIR = path.join(__dirname, 'TweetData', 'Threads');

const files = fs.readdirSync(THREADS_DIR);
for (const file of files) {
    if (file.endsWith('_thread.html')) {
        const id = file.replace('_thread.html', '');
        console.log(`Fetching ID: ${id}`);
        try {
            execSync(`node Scripts/fetch_only.js ${id}`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed on ${id}`);
        }
    }
}
console.log('All done!');
