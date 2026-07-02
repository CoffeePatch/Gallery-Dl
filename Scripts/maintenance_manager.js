const readline = require('readline');
const { runStats } = require('./lib/stats');
const { runFilterLargeVideos } = require('./lib/videoFilter');
const { runSeparateThreads } = require('./lib/threadSeparator');
const { runCleanSelfRetweets } = require('./lib/retweetCleaner');
const { runXCheckerScan, runXCheckerAuth } = require('./lib/accountChecker');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function showMenu() {
    console.log('\n=== X/Twitter Archive Maintenance Tool ===');
    console.log('1. Generate summary stats');
    console.log('2. Filter large videos');
    console.log('3. Separate threads');
    console.log('4. Clean self-retweets');
    console.log('5. Run X account status checker');
    console.log('6. Exit');
    console.log('==========================================');
    process.stdout.write('Enter choice (1-6): ');
}

async function runInteractiveMenu() {
    showMenu();
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (line) => {
        const choice = line.trim();
        rl.close();

        switch (choice) {
            case '1':
                await runStats();
                break;
            case '2':
                await runFilterLargeVideos();
                break;
            case '3':
                await runSeparateThreads();
                break;
            case '4':
                await runCleanSelfRetweets();
                break;
            case '5':
                await runXCheckerScan();
                break;
            case '6':
                console.log("Exiting... Goodbye!");
                process.exit(0);
            default:
                console.log("Invalid option. Please try again.");
                break;
        }
        
        // Loop back
        await wait(2000);
        runInteractiveMenu();
    });
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--stats')) {
        await runStats();
    } else if (args.includes('--filter-large')) {
        await runFilterLargeVideos();
    } else if (args.includes('--separate-threads')) {
        await runSeparateThreads();
    } else if (args.includes('--clean-retweets')) {
        await runCleanSelfRetweets();
    } else if (args.includes('--x-check')) {
        await runXCheckerScan();
    } else if (args.includes('--x-auth')) {
        await runXCheckerAuth();
    } else {
        await runInteractiveMenu();
    }
}

main().catch(console.error);
