const readline = require('readline');

function createStreamingParser(onRecord) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let recordBuffer = "";
    let tripwireFired = false;

    function processChar(char) {
        if (tripwireFired) return;
        
        if (escapeNext) {
            escapeNext = false;
            if (depth >= 2) recordBuffer += char;
            return;
        }
        
        if (char === '\\') {
            escapeNext = true;
            if (depth >= 2) recordBuffer += char;
            return;
        }
        
        if (char === '"') {
            inString = !inString;
            if (depth >= 2) recordBuffer += char;
            return;
        }
        
        if (!inString) {
            if (char === '[') {
                depth++;
                if (depth >= 2) recordBuffer += char;
                return;
            }
            if (char === ']') {
                if (depth >= 2) recordBuffer += char;
                depth--;
                if (depth === 1) {
                    try {
                        const record = JSON.parse(recordBuffer);
                        onRecord(record);
                    } catch (e) {
                        // ignore malformed record
                    }
                    recordBuffer = "";
                }
                return;
            }
        }
        
        if (depth >= 2) {
            recordBuffer += char;
        }
    }

    function processLine(line) {
        for (let i = 0; i < line.length; i++) {
            processChar(line[i]);
        }
        if (depth >= 2) {
            recordBuffer += "\n";
        }
    }

    function setupInputStream(inputStream) {
        const rl = readline.createInterface({
            input: inputStream,
            terminal: false
        });

        rl.on('line', (line) => {
            processLine(line);
        });

        return rl;
    }

    return {
        processChar,
        processLine,
        setupInputStream,
        setTripwireFired: (val) => { tripwireFired = val; },
        getDepth: () => depth,
        getBuffer: () => recordBuffer
    };
}

module.exports = {
    createStreamingParser
};
