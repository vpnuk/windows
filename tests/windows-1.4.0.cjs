'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const root = path.resolve(__dirname, '..');
const { createIkev2ProfileCommand, createIkev2IpsecCommand } = require('../app/modules/windows-ikev2');
const { render } = require('../scripts/build-changelog');

async function connectionCase(failure) {
    const commands = [];
    const logs = [];
    let dialled = false, connected = false, error;
    const profile = {
        vpnType: 'IKEv2', server: { dns: 'uk34.vpnuk.net', host: '192.0.2.34' },
        credentials: { login: 'test-user', password: 'test-secret-&\'"' },
    };
    class Base {
        constructor(p, hooks) {
            Object.assign(this, {
                type: p.vpnType, _name: 'VPNUK-IKEv2', _server: p.server,
                _credentials: p.credentials, _dns: {},
                _logStream: { write: text => logs.push(text), end() {} },
                _connectedHook: hooks.connectedHook, _errorHook: hooks.errorHook,
            });
        }
    }
    const mocks = {
        './VpnBase': Base,
        '../../modules/constants': { VpnType: { IKEv2: { label: 'IKEv2' } }, connectionStates: { connected: 'Connected', disconnected: 'Disconnected' } },
        '../../modules/windows-ikev2': { createIkev2ProfileCommand, createIkev2IpsecCommand },
        ini: {},
        '../utils/async': { spawnChild: async (file, args) => {
            const command = args.join(' ');
            commands.push(command);
            if (command.includes('Select -ExpandProperty ConnectionStatus')) return dialled && failure !== 'status' ? 'Connected' : 'Disconnected';
            if (command.includes('rasdial') && args.includes('/d')) dialled = false;
            if (command.includes('New-EapConfiguration') && failure === 'profile') throw new Error('EAP setup failed');
            if (command.includes('Set-VpnConnectionIPsecConfiguration') && failure === 'ipsec') throw new Error('IPsec setup failed');
            return '';
        } },
        child_process: {
            spawnSync: () => ({ status: 0 }),
            spawn: (file, args, options) => {
                dialled = true;
                assert(file.endsWith('powershell.exe'));
                assert.equal(options.shell, false);
                assert(args.includes('-NonInteractive'));
                assert(args[args.length - 1].endsWith('ikev2-connect.ps1'));
                assert(!args.join('').includes(profile.credentials.password));
                assert(!args.join('').includes(profile.credentials.login));
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.stdin = new EventEmitter();
                child.stdin.end = input => {
                    assert.deepEqual(JSON.parse(input), {
                        name: 'VPNUK-IKEv2', username: profile.credentials.login, password: profile.credentials.password,
                    });
                };
                child.kill = () => {};
                queueMicrotask(() => child.emit('close', failure === 'dial' ? 703 : 0));
                return child;
            },
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'app/main/vpn/WindowsVpn.js'), 'utf8'), {
        module, require: id => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id),
        process, __dirname: path.join(root, 'app/main/vpn'),
        setTimeout: (fn, delay) => delay === 600 ? (queueMicrotask(fn), 0) : setTimeout(fn, delay),
        clearTimeout, setInterval: () => 1, clearInterval() {},
    });
    const vpn = new module.exports(profile, {
        connectedHook: () => { connected = true; }, errorHook: err => { error = err; },
    }, {});
    await vpn.connect();
    assert.equal(dialled, failure !== 'profile' && failure !== 'ipsec');
    assert.equal(connected, !failure);
    assert.equal(Boolean(error), Boolean(failure));
    const setup = commands.find(command => command.includes('Add-VpnConnection'));
    assert(setup.includes("-ServerAddress 'uk34.vpnuk.net'"));
    assert(setup.includes('-AuthenticationMethod Eap'));
    assert(!setup.includes('192.0.2.34'));
    assert(!commands.join('').includes(profile.credentials.password));
    assert(!logs.join('').includes(profile.credentials.password));
    if (failure === 'profile') assert(logs.join('').includes('CONNECT FAILED — EAP setup failed'));
    if (failure === 'ipsec') assert(logs.join('').includes('CONNECT FAILED — IPsec setup failed'));
    if (failure) {
        const afterSetup = commands.slice(commands.indexOf(setup) + 1);
        assert(!afterSetup.some(command => command.includes('Remove-VpnConnection')));
        assert(logs.join('').includes('preserving failed Windows profile "VPNUK-IKEv2"'));
    }
    if (failure !== 'profile') {
        const ipsec = commands.find(command => command.includes('Set-VpnConnectionIPsecConfiguration'));
        assert(ipsec.includes('-AuthenticationTransformConstants SHA196'));
        assert(ipsec.includes('-CipherTransformConstants AES256'));
        assert(ipsec.includes('-DHGroup Group2'));
        assert(ipsec.includes('-EncryptionMethod AES256'));
        assert(ipsec.includes('-IntegrityCheckMethod SHA384'));
        assert(ipsec.includes('-PfsGroup None'));
        assert(ipsec.includes('-Force -ErrorAction Stop'));
        assert(commands.indexOf(ipsec) > commands.indexOf(setup));
    }
    if (!failure) {
        const beforeDisconnect = commands.length;
        await vpn.disconnect();
        assert(!commands.slice(beforeDisconnect).some(command => command.includes('Remove-VpnConnection')));
    }
}

async function main() {
    const cmd = createIkev2ProfileCommand("VPNUK-user's-profile", 'uk34.vpnuk.net');
    assert(cmd.includes("'VPNUK-user''s-profile'"));
    assert(cmd.includes('New-EapConfiguration -UseWinlogonCredential:$false -ErrorAction Stop'));
    assert(cmd.includes('-EapConfigXmlStream $eap.EapConfigXmlStream'));
    assert(cmd.includes("$ErrorActionPreference = 'Stop'"));
    assert(!/PEAP|%TEMP%|Set-VpnConnectionUsernamePassword/.test(cmd));
    for (const invalid of [null, '', 'host; injected', 'host\naction', '$(command)']) {
        assert.throws(() => createIkev2ProfileCommand('VPNUK-IKEv2', invalid));
    }
    console.log('PASS IKEv2 EAP command, explicit credentials policy and input quoting');
    await connectionCase(false);
    console.log('PASS IKEv2 prepares EAP profile and sends credentials over stdin, never argv');
    await connectionCase('profile');
    console.log('PASS EAP setup failure stops dialling and reports the error');
    await connectionCase('ipsec');
    assert(createIkev2IpsecCommand("user's-profile").includes("'user''s-profile'"));
    console.log('PASS server-compatible IPsec settings and fatal IPsec setup failure before dialling');
    await connectionCase('dial');
    await connectionCase('status');
    console.log('PASS failed IKEv2 profiles and normally disconnected profiles retained for reconnect');
    assert(cmd.includes('Get-VpnConnection -Name'));
    assert(cmd.includes('Set-VpnConnection -Name'));
    assert(cmd.includes('IKEv2 profile reused'));
    assert(!cmd.includes('Remove-VpnConnection'));
    const md = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const html = render(md);
    assert(html.includes('1.4.0') && html.includes('1.3.9'));
    assert(html.includes('</ul>') && !html.includes('<script'));
    assert(render('<script>alert(1)</script>').includes('&lt;script&gt;'));
    const pkg = require('../package.json');
    assert.equal(pkg.version, '1.4.0');
    assert(pkg.scripts['react-build'].endsWith('node scripts/build-changelog.js'));
    assert(pkg.build.extraFiles.some(file => file.from === 'build/changelog.html' && file.to === 'CHANGELOG.html'));
    for (const name of ['ikev2-connect.ps1', 'Ikev2Credentials.cs']) {
        assert(pkg.build.extraFiles.some(file => file.to === 'install-tools/' + name));
    }
    const worker = fs.readFileSync(path.join(root, 'nsis/ikev2-connect.ps1'), 'utf8');
    assert(worker.includes('[Console]::In.ReadToEnd()'));
    assert(worker.includes('rasdial.exe" $name'));
    assert(!worker.includes('rasdial.exe" $name $'));
    const native = fs.readFileSync(path.join(root, 'nsis/Ikev2Credentials.cs'), 'utf8');
    assert(native.includes('EapHostPeerCredentialsXml2Blob'));
    assert(native.includes('RasSetEapUserDataW'));
    assert(native.includes('RasGetEapUserIdentityW'));
    const nsis = fs.readFileSync(path.join(root, 'nsis/extension.nsh'), 'utf8');
    assert(nsis.includes('!macro customFinishPage'));
    assert(nsis.includes('MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\\CHANGELOG.html"'));
    assert(nsis.includes('MUI_FINISHPAGE_RUN_FUNCTION "StartApp"'));
    assert(nsis.includes('${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"'));
    console.log('PASS 1.4.0 version, bundled safe changelog and finish-screen Run option');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
