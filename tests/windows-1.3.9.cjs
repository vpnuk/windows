'use strict';
// No Windows commands or live VPN API requests are made by these tests.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');
const toolRequire = process.env.WINDOWS_TEST_TOOLS
    ? createRequire(path.resolve(process.env.WINDOWS_TEST_TOOLS, 'package.json'))
    : require;
const babel = toolRequire('@babel/core');
const commonjs = toolRequire('@babel/plugin-transform-modules-commonjs');
const mobx = toolRequire('mobx');
mobx.configure({ enforceActions: 'never' });
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const json = value => JSON.parse(JSON.stringify(value));
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vpnuk-win-test-'));
const folders = [];
const temp = () => { const dir = fresh(); folders.push(dir); return dir; };

function load(relative, mocks = {}, globals = {}) {
    const filename = path.join(root, relative);
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        plugins: [commonjs, ...(filename.endsWith('.jsx') ? [toolRequire('@babel/plugin-transform-react-jsx')] : [])],
        parserOpts: { plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods'] },
    }).code;
    const context = { module, exports: module.exports, require: id => (
        Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : realRequire(id)
    ), Buffer, process, console, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, ...globals };
    vm.runInNewContext(source, context, { filename });
    return module.exports;
}

const arch = require('../app/modules/windows-arch');
const bypass = require('../app/modules/ip-bypass');
test('split tunnelling expands, preserves drafts, validates and saves comma-separated rules per profile', () => {
    const { JSDOM } = toolRequire('jsdom');
    const React = toolRequire('react');
    const dom = new JSDOM('<!doctype html><div id="test-root"></div>', { pretendToBeVisual: true });
    const oldGlobals = {};
    // Use jsdom's browser globals, not Node's worker-thread MessageChannel:
    // React 17's scheduler otherwise leaves a worker port open after the test.
    for (const name of ['window', 'document', 'navigator', 'MessageChannel']) {
        oldGlobals[name] = Object.getOwnPropertyDescriptor(global, name);
        Object.defineProperty(global, name, { configurable: true, value: dom.window[name] });
    }
    const ReactDOM = toolRequire('react-dom');
    const { act, Simulate } = toolRequire('react-dom/test-utils');
    const container = dom.window.document.getElementById('test-root');
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', { get: () => 230 });
    let saves = 0;
    const store = {
        profiles: { currentProfile: { id: 'first', bypassIps: ['192.168.1.10/32'] } },
        triggerPersist() { saves++; },
    };
    class ResizeObserverMock { observe() {} disconnect() {} }
    const Component = load('app/renderer/components/IpBypassSettings.jsx', {
        react: React, mobx, 'mobx-react-lite': { observer: component => component },
        '@domain': { useStore: () => store }, '@modules/ip-bypass.js': bypass,
    }, { ResizeObserver: ResizeObserverMock }).default;
    const render = () => act(() => {
        ReactDOM.render(React.createElement(Component, { key: store.profiles.currentProfile.id }), container);
    });
    const toggle = () => container.querySelector('.ip-bypass-toggle');
    const input = () => container.querySelector('textarea');
    const change = text => act(() => Simulate.change(input(), { target: { value: text } }));
    try {
        render();
        assert.equal(toggle().textContent, 'SPLIT TUNNELLING — BYPASS IP ADDRESSES');
        assert.equal(toggle().getAttribute('aria-expanded'), 'false');
        assert.equal(container.querySelector('.ip-bypass-panel').style.height, '0px');
        assert.equal(input().tabIndex, -1);
        act(() => Simulate.click(toggle()));
        assert.equal(toggle().getAttribute('aria-expanded'), 'true');
        assert.equal(container.querySelector('.ip-bypass-panel').style.height, '230px');
        assert.equal(input().rows, 4);
        assert.equal(input().value, '192.168.1.10/32');
        assert.equal(container.querySelector('.ip-bypass-description').textContent.trim(),
            'Comma separated IPs bypass the VPN and Kill Switch.');
        change('192.168.1.20, 10.0.0.0/8');
        act(() => Simulate.click(toggle()));
        act(() => Simulate.click(toggle()));
        assert.equal(input().value, '192.168.1.20, 10.0.0.0/8', 'closing must preserve unsaved edits');
        act(() => Simulate.click(container.querySelector('.ip-bypass-save')));
        assert.deepEqual(json(store.profiles.currentProfile.bypassIps), ['192.168.1.20/32', '10.0.0.0/8']);
        assert.equal(input().value, '192.168.1.20/32, 10.0.0.0/8');
        assert.equal(saves, 1);
        assert(container.querySelector('[role="status"]'));
        change('example.com');
        act(() => Simulate.click(container.querySelector('.ip-bypass-save')));
        assert(container.querySelector('[role="alert"]'));
        assert.equal(saves, 1, 'invalid rules must not be persisted');
        change('');
        act(() => Simulate.click(container.querySelector('.ip-bypass-save')));
        assert.deepEqual(json(store.profiles.currentProfile.bypassIps), []);
        assert.equal(saves, 2, 'saving empty rules must clear the bypass list');
        store.profiles.currentProfile = { id: 'second', bypassIps: ['172.16.0.0/12'] };
        render();
        assert.equal(toggle().getAttribute('aria-expanded'), 'false');
        assert.equal(input().value, '172.16.0.0/12');
        assert(!container.querySelector('[role="alert"]'));
        assert(!container.textContent.includes('This is separate from WireGuard Allowed IPs'));
        assert(!container.textContent.includes('Domains and apps are not included'));
    } finally {
        act(() => { ReactDOM.unmountComponentAtNode(container); });
        dom.window.close();
        for (const name of Object.keys(oldGlobals)) {
            if (oldGlobals[name]) Object.defineProperty(global, name, oldGlobals[name]);
            else delete global[name];
        }
    }
});
test('split tunnelling uses its own four-row editor instead of single-line input styling', () => {
    const source = fs.readFileSync(path.join(root, 'app/renderer/components/IpBypassSettings.jsx'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'app/renderer/components/index.css'), 'utf8');
    assert(!source.includes('className="form-input"'));
    const style = css.match(/\.ip-bypass-input\s*\{([^}]+)\}/)[1];
    for (const rule of ['height: 110px', 'line-height: 22px', 'color: var(--text)', 'border-radius: 8px', 'resize: none']) {
        assert(style.includes(rule), `missing multiline editor style: ${rule}`);
    }
    assert(css.includes('transition: height 0.2s ease'));
    assert(css.includes('.ip-bypass-toggle:focus { outline: none; box-shadow: none; }'),
        'mouse clicks must not show the native orange/beige focus outline');
    assert(css.indexOf('.ip-bypass-toggle:focus-visible,') > css.indexOf('.ip-bypass-toggle:focus {'),
        'keyboard-only focus must override the mouse-click reset');
    const menu = fs.readFileSync(path.join(root, 'app/renderer/components/Menu.jsx'), 'utf8');
    assert(menu.includes('[VpnType.OpenVPN.label, VpnType.WireGuard.label].includes(store.settings.vpnType) && <IpBypassSettings'));
});
test('installer quotes the installed OpenVPN path and does not block upgrades on version-query failure', () => {
    const source = fs.readFileSync(path.join(root, 'nsis/extension.nsh'), 'utf8');
    const fn = source.match(/Function getOvpnVersion\r?\n([\s\S]*?)FunctionEnd/)[1];
    assert(fn.includes('nsExec::ExecToStack /TIMEOUT=10000 \'"$ovpnPath" --version\''));
    assert(/Pop \$R0[\s\S]*?Pop \$R1/.test(fn));
    assert(fn.includes('GetDLLVersion "$ovpnPath"'));
    assert(fn.includes('StrCpy $installedOvpnVer "version unavailable"'));
    assert(!fn.includes('MessageBox'));
    assert(!fn.includes('Abort'));
});
test('new renderer shared-module imports match the existing exact-file whitelist', () => {
    const allowed = new Set(fs.readdirSync(path.join(root, 'app/modules')).map(file => path.join(root, 'app/modules', file)));
    for (const file of ['wgApi.js', 'IpBypassSettings.jsx', 'OvpnDetails.jsx']) {
        const source = fs.readFileSync(path.join(root, 'app/renderer/components', file), 'utf8');
        for (const match of source.matchAll(/['"]@modules\/([^'"]+)['"]/g)) {
            assert(allowed.has(path.join(root, 'app/modules', match[1])), `${file}: shared module import must name the exact whitelisted file`);
        }
    }
});
test('draft feed names, version, size and hash match the final renamed installer', () => {
    const { writeMetadata } = require('../scripts/update-metadata');
    const folder = temp();
    const file = path.join(folder, 'VPNUK-Setup-1.3.9-build123.exe');
    const out = path.join(folder, 'latest.yml');
    fs.writeFileSync(file, 'fake installer bytes for metadata test only');
    const result = writeMetadata(file, out, '1.3.9');
    const yaml = fs.readFileSync(out, 'utf8');
    const hash = require('crypto').createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    assert.equal(result.hash, hash);
    assert.equal(result.size, fs.statSync(file).size);
    assert(yaml.includes('version: 1.3.9\n'));
    assert(yaml.includes('path: VPNUK-Setup-1.3.9-build123.exe\n'));
    assert(yaml.includes('url: VPNUK-Setup-1.3.9-build123.exe\n'));
    assert(yaml.includes(`sha512: ${hash}`));
    assert.throws(() => writeMetadata(file, out, '1.3.8-test'));
    assert.throws(() => writeMetadata(path.join(folder, 'Name with spaces.exe'), out, '1.3.9'));
});
test('native ARM64 is detected even with emulated x64 or ia32 Electron', () => {
    assert.equal(arch.windowsArch('x64', { PROCESSOR_ARCHITEW6432: 'ARM64' }), 'arm64');
    assert.equal(arch.windowsArch('ia32', { PROCESSOR_ARCHITECTURE: 'ARM64' }), 'arm64');
    assert.equal(arch.windowsArch('ia32', { PROCESSOR_ARCHITEW6432: 'AMD64' }), 'x64');
    assert.equal(arch.windowsArch('ia32', {}), 'ia32');
});
test('ARM uses versions.json arm64; missing ARM never falls back to x64', () => {
    const links = { arm64: 'https://example.test/arm.msi', win64: 'https://example.test/x64.msi', win32: 'https://example.test/x86.msi' };
    assert.equal(arch.downloadForArch(links, 'arm64'), links.arm64);
    assert.equal(arch.downloadForArch(links, 'x64'), links.win64);
    assert.equal(arch.downloadForArch(links, 'ia32'), links.win32);
    assert.throws(() => arch.downloadForArch({ win64: links.win64 }, 'arm64'));
    assert.throws(() => arch.downloadForArch({ arm64: 'http://example.test/a' }, 'arm64'));
});
test('native OpenVPN detection reads PE machine type rather than trusting the installed version', () => {
    const folder = temp();
    for (const [machine, expected] of [[0xaa64, 'arm64'], [0x8664, 'x64'], [0x14c, 'ia32']]) {
        const buffer = Buffer.alloc(128);
        buffer.writeUInt16LE(0x5a4d, 0);
        buffer.writeUInt32LE(80, 0x3c);
        buffer.write('PE\u0000\u0000', 80, 'ascii');
        buffer.writeUInt16LE(machine, 84);
        const file = path.join(folder, `${expected}.exe`);
        fs.writeFileSync(file, buffer);
        assert.equal(arch.executableArch(file), expected);
    }
});
test('bypass input is normalized and rejects invalid addresses and shell fragments', () => {
    assert.deepEqual(bypass.bypassPrefixes('192.168.1.7\n10.7.4.3/8,192.168.1.7'), ['192.168.1.7/32', '10.0.0.0/8']);
    for (const invalid of ['256.1.1.1', '1.2.3.4/33', 'example.com', '::1', '1.2.3.4 & calc.exe']) {
        assert.throws(() => bypass.bypassPrefixes(invalid));
    }
    assert.deepEqual(bypass.bypassPrefixes(''), []);
});
test('WireGuard bypass preserves existing Allowed IPs and removes only excluded IPv4 ranges', () => {
    assert.equal(bypass.subtractBypass('10.0.0.0/8', ['192.168.0.0/16']), '10.0.0.0/8');
    const result = bypass.subtractBypass('0.0.0.0/0, ::/0', ['10.0.0.0/8']);
    assert(!result.split(', ').includes('0.0.0.0/0'));
    assert(result.includes('::/1, 8000::/1'));
    assert(!result.split(', ').filter(v => !v.includes(':')).some(v => {
        const r = bypass.parseCidr(v);
        return r.start <= bypass.parseCidr('10.0.0.1').start && r.end >= bypass.parseCidr('10.0.0.1').start;
    }));
    assert.throws(() => bypass.subtractBypass('10.0.0.0/8', ['10.0.0.0/8']));
});
test('CIDR subtraction covers every intended address without adding routes outside Allowed IPs', () => {
    for (let offset = 0; offset < 256; offset += 7) {
        const result = bypass.subtractBypass('192.0.2.0/24', [`192.0.2.${offset}`]);
        const ranges = result.split(', ').map(bypass.parseCidr);
        for (let n = 0; n < 256; n++) {
            const address = bypass.parseCidr(`192.0.2.${n}`).start;
            assert.equal(ranges.filter(r => address >= r.start && address <= r.end).length, n === offset ? 0 : 1);
        }
        assert(ranges.every(r => r.start >= bypass.parseCidr('192.0.2.0/24').start && r.end <= bypass.parseCidr('192.0.2.0/24').end));
    }
});
test('WireGuard config transforms only AllowedIPs, leaving keys and endpoints intact', () => {
    const conf = '[Interface]\nPrivateKey = test-private\n[Peer]\nPublicKey = test-public\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 203.0.113.1:51820\n';
    const result = bypass.applyWireGuardBypass(conf, ['192.168.1.0/24']);
    assert(result.includes('PrivateKey = test-private'));
    assert(result.includes('Endpoint = 203.0.113.1:51820'));
    assert.equal(bypass.applyWireGuardBypass(conf, []), conf);
    assert.throws(() => bypass.applyWireGuardBypass('[Peer]\n', ['1.2.3.4']));
});

function configFixture(failAction) {
    const folder = temp();
    const calls = [];
    let serial = 0;
    const settingsPath = { folder, device: path.join(folder, 'device.json'), wgConf: () => path.join(folder, 'shared.conf') };
    const api = load('app/modules/wg-config.js', {
        './constants': { settingsPath },
        axios: { post: async (url, form) => {
            const input = new URLSearchParams(form);
            calls.push({ url, action: input.get('action'), server: input.get('server'), device: input.get('device_label') });
            if (input.get('action') === failAction) return { data: { error: 'API rejected request' } };
            return { data: input.get('action') === 'delete_config' ? { success: true } : {
                config: `[Interface]\nPrivateKey = test-key-${++serial}\nAddress = 10.0.0.2/32\n[Peer]\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = uk1.example.test:51820\n`,
            } };
        } },
    });
    return { api, settingsPath, calls, profile: { credentials: { login: 'test', password: 'test' }, server: { host: '203.0.113.1' }, bypassIps: ['192.168.1.0/24'], details: { mtu: { value: 1380 } } } };
}
test('every connect releases the old peer and fetches a new config with stable device identity', async () => {
    const f = configFixture();
    await f.api.createConfig(f.profile);
    const first = fs.readFileSync(f.settingsPath.wgConf(), 'utf8');
    await f.api.createConfig(f.profile);
    const second = fs.readFileSync(f.settingsPath.wgConf(), 'utf8');
    assert.notEqual(first, second);
    assert.deepEqual(f.calls.map(c => c.action), ['delete_config', 'get_config', 'delete_config', 'get_config']);
    assert.equal(new Set(f.calls.map(c => c.device)).size, 1);
    assert(second.includes('Endpoint = 203.0.113.1:51820'));
    assert(second.includes('MTU = 1380'));
    assert(!second.includes('AllowedIPs = 0.0.0.0/0'));
    f.api.removeLocalConfig(f.profile);
    assert(!fs.existsSync(f.settingsPath.wgConf()));
});
test('failed server release cannot reuse old local keys or silently fetch another peer', async () => {
    const f = configFixture('delete_config');
    fs.writeFileSync(f.settingsPath.wgConf(), 'old-private-key');
    await assert.rejects(() => f.api.createConfig(f.profile));
    assert(!fs.existsSync(f.settingsPath.wgConf()));
    assert.deepEqual(f.calls.map(c => c.action), ['delete_config']);
});
test('switching server releases the old endpoint as well as the selected endpoint', async () => {
    const f = configFixture();
    fs.writeFileSync(f.settingsPath.wgConf(), '[Peer]\nEndpoint = 198.51.100.8:51820\n');
    await f.api.createConfig(f.profile);
    assert.deepEqual(f.calls.map(c => c.server), ['198.51.100.8', '', '203.0.113.1']);
});

function tunnelFixture(states, services = []) {
    const calls = [];
    let lastState = states[0];
    const tunnel = load('app/main/utils/wg-tunnels.js', {
        '../../modules/constants': { settingsFolder: 'C:\\Users\\test\\AppData\\Roaming\\VPNUK' },
        fs: { existsSync: () => false },
        child_process: { spawnSync: (file, args, opts) => {
            assert.equal(opts.shell, false);
            calls.push({ file, args });
            if (file === 'powershell.exe') return { status: 0, stdout: JSON.stringify(services) };
            if (args[0] === 'query') {
                if (states.length) lastState = states.shift();
                return lastState === null ? { status: 1060, stdout: 'FAILED 1060' }
                    : { status: 0, stdout: `STATE              : ${lastState} SOME_LOCALIZED_DISPLAY_NAME` };
            }
            return { status: 0, stdout: '' };
        } },
    });
    return { tunnel, calls };
}
test('external WireGuard removal still stops and deletes the owned tunnel through Service Control', () => {
    const f = tunnelFixture([4, 3, 1, null]);
    f.tunnel.stopAndRemoveTunnel('shared', null);
    assert.deepEqual(f.calls.filter(c => c.file === 'sc.exe').map(c => c.args[0]), ['query', 'stop', 'query', 'query', 'delete', 'query']);
    assert(f.calls.every(c => c.file !== 'wireguard.exe'));
});
test('a driver that does not stop is never deleted', () => {
    const f = tunnelFixture([4]);
    assert.throws(() => f.tunnel.stopAndRemoveTunnel('shared', null), /did not stop/);
    assert(!f.calls.some(c => c.args[0] === 'delete'));
});
test('already absent services are harmless; shell metacharacters are rejected', () => {
    const f = tunnelFixture([null]);
    f.tunnel.stopAndRemoveTunnel('shared', null);
    assert.throws(() => f.tunnel.stopAndRemoveTunnel('shared & calc', null));
    assert(!f.calls.some(c => c.args[0] === 'delete'));
});
test('service state parsing also works with localized Windows labels', () => {
    const api = load('app/main/utils/wg-tunnels.js', {
        '../../modules/constants': { settingsFolder: 'C:\\VPNUK' },
        child_process: { spawnSync: () => ({
            status: 0, stdout: 'NOM_SERVICE: WireGuardTunnel$shared\n        TYPE               : 10 WIN32_OWN_PROCESS\n        ÉTAT               : 4 EN_COURS\n',
        }) },
    });
    assert.equal(api.serviceState('shared'), 4);
});
test('startup cleanup distinguishes VPNUK config paths from other WireGuard applications', () => {
    const f = tunnelFixture([], [
        { Name: 'WireGuardTunnel$shared', PathName: '"C:\\Program Files\\WireGuard\\wireguard.exe" /tunnelservice "C:\\Users\\test\\AppData\\Roaming\\VPNUK\\shared.conf"' },
        { Name: 'WireGuardTunnel$other', PathName: '"C:\\Program Files\\WireGuard\\wireguard.exe" /tunnelservice "C:\\OtherVPN\\other.conf"' },
    ]);
    assert.deepEqual(json(f.tunnel.findOwnedTunnels()), ['shared']);
});

function lifecycleFixture({ offlineCleanup = false, stopFails = false } = {}) {
    const events = [];
    let installed = true;
    let watcher;
    class Base {
        constructor(profile, hooks) {
            this._logStream = { write: () => {}, end: () => events.push('log-closed') };
            this._connectingHook = hooks.connectingHook;
            this._connectedHook = hooks.connectedHook;
            this._disconnectedHook = hooks.disconnectedHook;
            this._errorHook = hooks.errorHook;
        }
    }
    const { WireGuard } = load('app/main/vpn/WireGuard.js', {
        './VpnBase': Base,
        fs: { existsSync: () => installed },
        '../utils/bypass-routes': { cleanupBypassRoutes: () => events.push('routes-removed') },
        '../../modules/wg-config': {
            confPath: () => '/test/vpnuk-profile.conf',
            createConfig: async () => { events.push('new-config'); return { file: '/test/vpnuk-profile.conf', server: '203.0.113.1' }; },
            removeLocalConfig: () => events.push('keys-removed'),
            releaseConfig: async () => {
                events.push('remote-release');
                if (offlineCleanup) throw new Error('Offline');
            },
        },
        '../utils/wg-tunnels': {
            serviceState: () => 4,
            stopAndRemoveTunnel: (name, exe) => {
                events.push(exe ? 'stop-with-exe' : 'stop-without-exe');
                if (stopFails) throw new Error('Service did not stop');
            },
            cleanupOwnedTunnels: () => events.push('orphans-cleaned'),
        },
        child_process: { spawnSync: (_, args) => {
            if (args[0] === '/installtunnelservice') events.push('service-installed');
            return { status: 0, stdout: 'InstallationDirectory REG_SZ C:\\WireGuard' };
        } },
    }, { setInterval: callback => { watcher = callback; return 1; }, clearInterval: () => {} });
    const vpn = new WireGuard({ id: 'profile', credentials: { login: 'test', password: 'test' } }, {
        connectingHook: () => events.push('connecting'),
        connectedHook: () => events.push('connected'),
        disconnectedHook: intentional => events.push(intentional ? 'disconnected' : 'dropped'),
        errorHook: error => events.push(`error:${error.message}`),
    });
    return { vpn, events, removeExternalApp: () => { installed = false; }, tick: () => watcher() };
}
test('WireGuard serializes connect/disconnect and deletes keys only after stopping the driver', async () => {
    const f = lifecycleFixture();
    const connect = f.vpn.connect();
    const disconnect = f.vpn.disconnect();
    await Promise.all([connect, disconnect]);
    assert.equal(f.vpn.getConnectionStatus(), 'Disconnected');
    assert(f.events.indexOf('new-config') < f.events.indexOf('service-installed'));
    assert(f.events.indexOf('connected') < f.events.indexOf('keys-removed'));
    assert(f.events.indexOf('keys-removed') < f.events.indexOf('remote-release'));
    assert(f.events.includes('disconnected'));
});
test('external uninstall while connected triggers watcher cleanup without wireguard.exe', async () => {
    const f = lifecycleFixture();
    await f.vpn.connect();
    f.removeExternalApp();
    f.tick();
    await f.vpn.disconnect(); // queue waits for watcher cleanup as well
    assert(f.events.includes('stop-without-exe'));
    assert(f.events.includes('keys-removed'));
    assert(f.events.includes('dropped'));
});
test('an unsuccessful driver stop does not delete keys or report a clean disconnect', async () => {
    const f = lifecycleFixture();
    await f.vpn.connect();
    const other = lifecycleFixture({ stopFails: true });
    await assert.rejects(() => other.vpn.connect());
    assert(!other.events.includes('keys-removed'));
    assert(!other.events.includes('disconnected'));
    await f.vpn.disconnect();
});
test('offline remote deletion still removes local keys and reports deferred server cleanup', async () => {
    const f = lifecycleFixture({ offlineCleanup: true });
    await f.vpn.connect();
    await f.vpn.disconnect();
    assert(f.events.includes('keys-removed'));
    assert(f.events.some(event => event.includes('Server-side cleanup could not finish')));
    assert.equal(f.vpn.getConnectionStatus(), 'Disconnected');
});
test('profile hydration completes before observing; nested edits and explicit saves are immediate', () => {
    const disk = new Map([['profiles', JSON.stringify({ profiles: { OpenVPN: [{ id: 'saved', label: 'Saved', credentials: { login: 'old' } }] } })]]);
    const writes = [];
    class Store {
        get(key) { return disk.get(key); }
        set(key, value) { writes.push(key); disk.set(key, value); }
    }
    const persistor = load('app/renderer/domain/store/persistence/persistor.js', {
        'electron-store': Store,
        mobx,
        './migrator': (name, data) => data,
    }).default;
    const store = mobx.observable({ profiles: { OpenVPN: [{ id: 'default', label: 'Default' }] } });
    persistor(store, 'profiles', ['profiles']);
    assert.equal(store.profiles.OpenVPN[0].id, 'saved');
    assert.equal(JSON.parse(disk.get('profiles')).profiles.OpenVPN[0].id, 'saved');
    store.profiles.OpenVPN[0].credentials.login = 'changed-without-disconnecting';
    assert.equal(JSON.parse(disk.get('profiles')).profiles.OpenVPN[0].credentials.login, 'changed-without-disconnecting');
    store.profiles.OpenVPN.push({ id: 'new', label: 'New before forced exit' });
    assert.equal(JSON.parse(disk.get('profiles')).profiles.OpenVPN.length, 2);
    store.saveNow();
    assert(writes.length >= 4);
    const restarted = mobx.observable({ profiles: {} });
    persistor(restarted, 'profiles', ['profiles']);
    assert.equal(restarted.profiles.OpenVPN[1].id, 'new');
});
test('explicit Save Profile reports disk write errors rather than claiming success', () => {
    class Store { get() {} set() { throw new Error('Disk full'); } }
    const persistor = load('app/renderer/domain/store/persistence/persistor.js', {
        'electron-store': Store, mobx, './migrator': (_, value) => value,
    }).default;
    const store = mobx.observable({ profiles: {} });
    persistor(store, 'profiles', ['profiles']);
    assert.throws(() => store.saveNow(), /Disk full/);
});
test('bypass routes are bound to the physical interface and recovered without touching other routes', () => {
    const folder = temp();
    const scripts = [];
    const api = load('app/main/utils/bypass-routes.js', {
        '../../modules/constants': { settingsFolder: folder },
        child_process: { spawnSync: (file, args, options) => {
            assert.equal(options.shell, false);
            const script = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
            scripts.push(script);
            return { status: 0, stdout: script.includes(').InterfaceIndex') ? '7' : script.includes(').Count') ? '0' : '' };
        } },
    });
    api.installBypassRoutes(['192.0.2.1'], '192.168.1.1');
    const journal = path.join(folder, 'bypass-routes.json');
    assert.equal(JSON.parse(fs.readFileSync(journal))[0].index, 7);
    api.cleanupBypassRoutes();
    assert.deepEqual(JSON.parse(fs.readFileSync(journal)), []);
    assert(scripts.some(s => s.includes('New-NetRoute') && s.includes('-InterfaceIndex 7') && s.includes('-PolicyStore ActiveStore')));
    assert(scripts.some(s => s.includes('Remove-NetRoute') && s.includes('-NextHop') && s.includes('RouteMetric -eq 3')));
});

(async () => {
    let failures = 0;
    for (const item of tests) {
        try { await item.fn(); console.log(`PASS ${item.name}`); }
        catch (error) { failures++; console.error(`FAIL ${item.name}\n${error.stack}`); }
    }
    for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
    console.log(`${tests.length - failures}/${tests.length} checks passed.`);
    process.exitCode = failures ? 1 : 0;
})();
