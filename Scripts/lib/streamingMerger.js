const fs = require('fs');
const readline = require('readline');
const { createStreamingParser } = require('./streamingParser');
const { getRecordKey } = require('./recordSchema');

function streamRecordsFromFile(filePath, onRecord) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) return resolve();
        
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const parser = createStreamingParser((record) => {
            onRecord(record);
        });
        const rl = parser.setupInputStream(stream);
        
        rl.on('close', () => resolve());
        stream.on('error', (err) => reject(err));
    });
}

async function preloadIdsFromArchiveStream(filePath, knownIdsSet) {
    if (!fs.existsSync(filePath)) return;
    await streamRecordsFromFile(filePath, (record) => {
        const key = getRecordKey(record);
        knownIdsSet.add(key);
        if (Array.isArray(record) && record[0] === 2 && record[1] && record[1].tweet_id) {
            knownIdsSet.add(String(record[1].tweet_id));
        }
    });
}

async function mergeStreamsToFile(existingFilePath, newRecordsFilePath, outputFilePath, knownIdsSet = new Set()) {
    const writeStream = fs.createWriteStream(outputFilePath, { encoding: 'utf8' });
    
    writeStream.write('[\n');
    
    let isFirst = true;
    let totalCount = 0;
    let duplicatesRemoved = 0;
    let existingCount = 0;
    let newlyAddedUnique = 0;

    const writeRecord = (record) => {
        const key = getRecordKey(record);
        if (!knownIdsSet.has(key)) {
            knownIdsSet.add(key);
            if (Array.isArray(record) && record[0] === 2 && record[1] && record[1].tweet_id) {
                knownIdsSet.add(String(record[1].tweet_id));
            }
            
            const jsonStr = JSON.stringify(record, null, 2).replace(/\n/g, '\n  ');
            if (!isFirst) {
                writeStream.write(',\n  ' + jsonStr);
            } else {
                writeStream.write('  ' + jsonStr);
                isFirst = false;
            }
            totalCount++;
            return true;
        } else {
            duplicatesRemoved++;
            return false;
        }
    };

    if (newRecordsFilePath && fs.existsSync(newRecordsFilePath)) {
        await streamRecordsFromFile(newRecordsFilePath, (record) => {
            if (writeRecord(record)) {
                newlyAddedUnique++;
            }
        });
    }

    if (existingFilePath && fs.existsSync(existingFilePath)) {
        await streamRecordsFromFile(existingFilePath, (record) => {
            existingCount++;
            writeRecord(record);
        });
    }

    writeStream.write('\n]\n');
    
    await new Promise((resolve) => writeStream.end(resolve));

    return {
        totalCount,
        existingCount,
        newlyAddedUnique,
        duplicatesRemoved
    };
}

module.exports = {
    streamRecordsFromFile,
    preloadIdsFromArchiveStream,
    mergeStreamsToFile
};
