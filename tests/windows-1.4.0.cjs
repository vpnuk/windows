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
            if (command.includes('Select -ExpandProperty ConnectionStatus')) return dialled ? 'Connected' : 'Disconnected';
            if (command.includes('New-EapConfiguration') && failure === 'profile') throw new Error('EAP setup failed');
            if (command.includes('Set-VpnConnectionIPsecConfiguration') && failure === 'ipsec') throw new Error('IPsec setup failed');
            return '';
        } },
        child_process: {
            spawnSync: () => ({ status: 0 }),
            spawn: (file, args, options) => {
                dialled = true;
                assert.equal(file, 'rasdial');
                assert.equal(options.shell, false);
                assert.deepEqual(Array.from(args), ['VPNUK-IKEv2', profile.credentials.login, profile.credentials.password]);
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.kill = () => {};
                queueMicrotask(() => child.emit('close', 0));
                return child;
            },
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'app/main/vpn/WindowsVpn.js'), 'utf8'), {
        module, require: id => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id),
        setTimeout: (fn, delay) => delay === 600 ? (queueMicrotask(fn), 0) : setTimeout(fn, delay),
        clearTimeout, setInterval: () => 1, clearInterval() {},
    });
    const vpn = new module.exports(profile, {
        connectedHook: () => { connected = true; }, errorHook: err => { error = err; },
    }, {});
    await vpn.connect();
    assert.equal(dialled, !failure);
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
    console.log('PASS IKEv2 creates EAP profile before dialling with VPNUK credentials');
    await connectionCase('profile');
    console.log('PASS EAP setup failure stops dialling and reports the error');
    await connectionCase('ipsec');
    assert(createIkev2IpsecCommand("user's-profile").includes("'user''s-profile'"));
    console.log('PASS server-compatible IPsec settings and fatal IPsec setup failure before dialling');
    const md = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const html = render(md);
    assert(html.includes('1.4.0') && html.includes('1.3.9'));
    assert(html.includes('</ul>') && !html.includes('<script'));
    assert(render('<script>alert(1)</script>').includes('&lt;script&gt;'));
    const pkg = require('../package.json');
    assert.equal(pkg.version, '1.4.0');
    assert(pkg.scripts['react-build'].endsWith('node scripts/build-changelog.js'));
    assert(pkg.build.extraFiles.some(file => file.from === 'build/changelog.html' && file.to === 'CHANGELOG.html'));
    const nsis = fs.readFileSync(path.join(root, 'nsis/extension.nsh'), 'utf8');
    assert(nsis.includes('!macro customFinishPage'));
    assert(nsis.includes('MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\\CHANGELOG.html"'));
    assert(nsis.includes('MUI_FINISHPAGE_RUN_FUNCTION "StartApp"'));
    assert(nsis.includes('${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"'));
    console.log('PASS 1.4.0 version, bundled safe changelog and finish-screen Run option');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
