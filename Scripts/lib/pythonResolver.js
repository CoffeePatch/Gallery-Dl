const { spawnSync } = require('child_process');

let cachedPythonCmd = null;

function getPythonCommand() {
    if (cachedPythonCmd) {
        return cachedPythonCmd;
    }

    if (process.env.PYTHON) {
        cachedPythonCmd = process.env.PYTHON;
        return cachedPythonCmd;
    }

    const res3 = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    if (res3.status === 0 && !res3.error) {
        cachedPythonCmd = 'python3';
        return cachedPythonCmd;
    }

    cachedPythonCmd = 'python';
    return cachedPythonCmd;
}

module.exports = {
    getPythonCommand
};
