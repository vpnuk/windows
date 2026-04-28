const { settingsFolder } = require('../../modules/constants');
const path = require('path');
const fs = require('fs');
const isDev = process.env.ELECTRON_ENV === 'Dev'

const logDir = path.join(settingsFolder, 'logs');
const mkdirIfNotExistsSync = path => !fs.existsSync(path) && fs.mkdirSync(path, { recursive: true });

const getLogPath = id =>
    path.join(logDir, id + '.log');

const getLogFileStream = id => {
    mkdirIfNotExistsSync(logDir);
    const logPath = getLogPath(id);
    isDev && console.log(logPath);
    return fs.createWriteStream(logPath);
};
exports.getLogFileStream = getLogFileStream;

/**
 * Append a single line to a profile's log file synchronously.
 * Used by the `log-append` IPC handler so the renderer can write
 * diagnostic lines (wgApi steps, credential errors, etc.) into the
 * same log file that WireGuard/OpenVPN use.
 */
const appendToLog = (id, line) => {
    mkdirIfNotExistsSync(logDir);
    const ts = new Date().toISOString();
    fs.appendFileSync(getLogPath(id), `[${ts}] ${line}\n`, 'utf-8');
};
exports.appendToLog = appendToLog;

const openLogFileExternal = id => {
    const logPath = getLogPath(id);

    if (!fs.existsSync(logPath) || !fs.lstatSync(logPath).isFile()) {
        throw new Error('No log yet — connect first to generate one.');
    }

    var proc = require('child_process')
        .execFile('explorer', [logPath]);

    if (isDev) {
        console.log(proc.spawnargs);

        proc.stdout.on('data', data => {
            console.log(data);
        });
        proc.stderr.on('data', data => {
            console.log(data);
        });
        proc.on('close', code => {
            console.log(code);
        });
    }

    return proc;
}
exports.openLogFileExternal = openLogFileExternal;