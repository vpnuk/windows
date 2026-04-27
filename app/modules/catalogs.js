const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { settingsPath, settingsLink } = require('./constants');
const AdmZip = require('adm-zip');

const dowloadOvpnConfig = (link, filePath) =>
    axios
        .get(link)
        .then(response => {
            var file = fs.openSync(filePath, 'w');
            ('' + response.data).split('\n').forEach(line => {
                if (!(line.startsWith('#')
                    || line.startsWith('proto')
                    || line.startsWith('remote')
                    || line.startsWith('auth-user-pass'))) {

                    fs.appendFileSync(file, line + '\n');
                }
            });
            fs.closeSync(file);
        })
        .catch(error => console.log('error', error));

const dowloadJson = (link, filePath) =>
    axios
        .get(link)
        .then(response => fs.writeFileSync(
            filePath, JSON.stringify(response.data, undefined, 2)))
        .catch(error => console.log('error', error));

const downloadPatchedOvpnExe = links => {
    let link = getLinkByArch(links);
    if (fs.existsSync(settingsPath.ovpnBinFolder)) {
        fs.rmdirSync(settingsPath.ovpnBinFolder, { recursive: true });
    }
    const zipFile = path.join(require('os').tmpdir(), '\\', path.basename(link));
    return axios
        .get(link, { responseType: 'arraybuffer' })
        .then(response => fs.writeFileSync(zipFile, new Buffer.from(response.data)))
        .catch(error => console.log('error', error))
        .then(() => {
            let success = false;
            try {
                let zip = new AdmZip(zipFile);
                fs.mkdirSync(settingsPath.ovpnBinFolder, { recursive: true });
                zip.extractAllTo(settingsPath.ovpnBinFolder, true);
                success = true;
            } catch (error) {
                console.log('error', error)
            } finally {
                if (fs.existsSync(zipFile)) {
                    fs.unlinkSync(zipFile);
                }
            }
            return success;
        });
};
exports.downloadPatchedOvpnExe = downloadPatchedOvpnExe;

exports.downloadOvpnUpdate = links => {
    let link = getLinkByArch(links);
    let file = path.resolve(require('os').tmpdir() + '\\' + path.basename(link));
    return axios
        .get(link, { responseType: 'arraybuffer' })
        .then(response => fs.writeFileSync(file, new Buffer.from(response.data)))
        .catch(error => console.log('error', error))
        .then(() => { return file; });
};

const downloadFile = (link, filePath) =>
    axios
        .get(link, { responseType: 'arraybuffer' })
        .then(response => fs.writeFileSync(filePath, new Buffer.from(response.data)))
        .catch(error => console.log('error', error));

const handlerServerDnsStructure = arr => [
    { value: [], label: 'DNS: Default' },
    ...arr.map(dnsItem => ({
        label: dnsItem.name,
        value: [dnsItem.primary, dnsItem.secondary]
    }))
];

const handlerServerTypesStructure = (arr, types) =>
    Object.assign({}, ...types.map(type => ({
        [type]: arr
            .filter(server => server.type === type)
            .map(server => ({
                label: server.location.name,
                city: server.location.city,
                countryCode: server.location.icon,
                host: server.address,
                type: server.type,
                dns: server.dns
            }))
    })));

const isObfuscateAvailable = () => fs.existsSync(settingsPath.ovpnBinExe);
exports.isObfuscateAvailable = isObfuscateAvailable;

const getVersions = file => fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file)) : null;

const getLinkByArch = node => process.arch === 'x32'
    ? node.win32 : node.win64;

// ─── WireGuard Install Check ──────────────────────────────────────────────────

const downloadWireGuardInstaller = (installerUrl) => {
    const tmpPath = path.join(require('os').tmpdir(), 'wireguard-installer.exe');
    return axios
        .get(installerUrl, { responseType: 'arraybuffer' })
        .then(response => fs.writeFileSync(tmpPath, new Buffer.from(response.data)))
        .catch(error => console.log('WG installer download error', error))
        .then(() => tmpPath);
};
exports.downloadWireGuardInstaller = downloadWireGuardInstaller;

// ─── initializeCatalogs ───────────────────────────────────────────────────────

function initializeCatalogs() {
    if (!fs.existsSync(settingsPath.folder)) {
        fs.mkdirSync(settingsPath.folder);
    };
    const oldVers = getVersions(settingsPath.versions);
    let ipseckey, ikev2Cert, wgInstaller;

    return axios.get(settingsLink.versions, { timeout: 8000 })
        .then(response => response.data)
        .catch(error => {
            console.log('versions fetch error', error?.message);
            return null; // graceful fallback — use cached
        })
        .then(newVers => {
            if (!newVers) {
                // No internet — use cached data if available
                ipseckey = oldVers?.ipseckey;
                return Promise.resolve();
            }

            var downloads = [];
            if (!oldVers || (oldVers.ovpn !== newVers.ovpn)
                || !fs.existsSync(settingsPath.ovpn) || !fs.existsSync(settingsPath.ovpnObfucation)) {
                downloads.push(dowloadOvpnConfig(settingsLink.ovpn, settingsPath.ovpn));
                downloads.push(dowloadOvpnConfig(settingsLink.ovpnObfucation, settingsPath.ovpnObfucation));
            }

            // Always refresh server list on every startup
            downloads.push(dowloadJson(settingsLink.servers, settingsPath.servers));

            if (!oldVers || (oldVers.dns !== newVers.dns) || !fs.existsSync(settingsPath.dns)) {
                downloads.push(dowloadJson(settingsLink.dns, settingsPath.dns));
            }
            if (!oldVers || (oldVers.ikev2?.version !== newVers.ikev2?.version) || !fs.existsSync(settingsPath.ikev2Cert)) {
                downloads.push(downloadFile(newVers.ikev2.cert, settingsPath.ikev2Cert));
                ikev2Cert = true;
            }
            if (!oldVers || !fs.existsSync(settingsPath.ovpnBinExe)) {
                downloads.push(downloadPatchedOvpnExe(newVers.openvpn.patch));
            }

            // WireGuard — pass installer URL to renderer so it can request install via IPC
            // (main process does the actual check and silent install in handlers.js)
            // Reads from versions.json -> windows.wireguard.installer
            const wgEntry = newVers.windows?.wireguard || newVers.wireguard;
            if (wgEntry?.installer) {
                wgInstaller = wgEntry.installer;
            }

            if (newVers && (!oldVers || downloads.length > 0)) {
                fs.writeFileSync(settingsPath.versions, JSON.stringify(newVers, undefined, 2));
            }
            ipseckey = newVers.ipseckey ? newVers.ipseckey : oldVers?.ipseckey;
            return Promise.all(downloads);
        })
        .then(() => {
            const dnsPath = settingsPath.dns;
            const serversPath = settingsPath.servers;
            if (!fs.existsSync(dnsPath) || !fs.existsSync(serversPath)) {
                throw new Error('OFFLINE_NO_CACHE');
            }
            return Promise.all([
                JSON.parse(fs.readFileSync(dnsPath)),
                JSON.parse(fs.readFileSync(serversPath))
            ]);
        })
        .then(result => ({
            dns: handlerServerDnsStructure(result[0].dns),
            servers: handlerServerTypesStructure(result[1].servers,
                ['shared', 'dedicated', 'dedicated11']),
            isObfuscateAvailable: isObfuscateAvailable(),
            ipseckey: ipseckey,
            installIKEv2Cert: ikev2Cert,
            wgInstaller: wgInstaller,
            offlineMode: false
        }));
};
exports.initializeCatalogs = initializeCatalogs;

exports.checkOvpnUpdates = () => {
    const oldVers = getVersions(settingsPath.versions);
    return axios.get(settingsLink.versions)
        .then(response => response.data)
        .catch(error => console.log('error', error))
        .then(newVers => {
            if (!oldVers?.openvpn || oldVers.openvpn.version !== newVers?.openvpn?.version) {
                return newVers?.openvpn;
            }
        });
};
