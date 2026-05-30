const { Menu, Tray, nativeImage, shell } = require('electron');
const { connectionStates } = require('../modules/constants');
const path = require('path');

const TAWK_URL  = 'https://tawk.to/chat/56bae5de496019e65d794d8f/default';
const VPNUK_URL = 'https://www.vpnuk.net';

const _icons = {
    'disconnected': 'icon_gray.png',
    'connecting':   'icon_sepia.png',
    'connected':    'icon_connected.png'
};

const iconPaths = Object.assign({}, ...Object.keys(connectionStates).map(key => ({
    [connectionStates[key]]: path.join(__dirname, '../assets', _icons[key])
})));

const icons = Object.assign({}, ...Object.keys(iconPaths).map(key => ({
    [key]: nativeImage
        .createFromPath(iconPaths[key])
        .resize({ width: 16, height: 16 })
})));

const tooltipBase = 'VPNUK';

class AppTray {
    #tray          = null;
    #onShow        = null;
    #onConnect     = null;   // (profileId) => void
    #onDisconnect  = null;   // () => void
    #onToggleTaskbar = null; // () => void

    // Live state — updated via set* methods, triggers #rebuild()
    #connStatus    = connectionStates.disconnected;
    #statusMsg     = 'Disconnected';
    #vpnType       = '';
    #server        = '';
    #externalIp    = '';
    #profiles      = [];
    #activeId      = null;
    #inTaskbar     = true;

    constructor({ onShow, onConnect, onDisconnect, onToggleTaskbar } = {}) {
        this.#tray           = new Tray(icons[connectionStates.disconnected]);
        this.#onShow         = onShow        || (() => {});
        this.#onConnect      = onConnect     || (() => {});
        this.#onDisconnect   = onDisconnect  || (() => {});
        this.#onToggleTaskbar = onToggleTaskbar || (() => {});
        this.#tray.setToolTip(tooltipBase);
        this.#rebuild();
    }

    // ── Public state setters ──────────────────────────────────────────────────

    setConnectedState(message) {
        this.#connStatus = connectionStates.connected;
        this.#statusMsg  = message;
        this.#sync();
        this.#balloon(message, connectionStates.connected);
    }

    setDisconnectedState(message) {
        this.#connStatus = connectionStates.disconnected;
        this.#statusMsg  = message;
        this.#externalIp = '';
        this.#vpnType    = '';
        this.#server     = '';
        this.#sync();
        this.#balloon(message, connectionStates.disconnected);
    }

    setConnectingState(message) {
        this.#connStatus = connectionStates.connecting;
        this.#statusMsg  = message;
        this.#sync();
        this.#balloon(message, connectionStates.connecting);
    }

    // Update icon/tooltip/menu without a balloon notification.
    setStateSilent(state, message) {
        this.#connStatus = state;
        this.#statusMsg  = message;
        this.#sync();
    }

    setExternalIp(ip) {
        this.#externalIp = ip || '';
        this.#rebuild();
    }

    setConnectionDetails(vpnType, server) {
        this.#vpnType = vpnType || '';
        this.#server  = server  || '';
        this.#rebuild();
    }

    // profiles: [{ id, label, vpnType }], activeId: string
    setProfiles(profiles, activeId) {
        this.#profiles = profiles || [];
        this.#activeId = activeId || null;
        this.#rebuild();
    }

    setInTaskbar(value) {
        this.#inTaskbar = !!value;
        this.#rebuild();
    }

    // Show a balloon without changing icon/tooltip/menu.
    notify(title, content, state = connectionStates.disconnected) {
        this.#balloon(content, state, title);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    #sync() {
        const s = this.#connStatus in icons ? this.#connStatus : connectionStates.disconnected;
        this.#tray.setImage(icons[s]);
        this.#tray.setToolTip(`${tooltipBase}: ${this.#statusMsg}`);
        this.#rebuild();
    }

    #balloon(content, state, title) {
        const s = state in iconPaths ? state : connectionStates.disconnected;
        this.#tray.displayBalloon({
            iconType: 'custom',
            icon: iconPaths[s],
            title: title || `${tooltipBase}: ${content}`,
            content,
        });
    }

    #statusItems() {
        const conn = this.#connStatus === connectionStates.connected;
        const busy = conn || this.#connStatus === connectionStates.connecting;

        const dot   = conn ? '●' : busy ? '◌' : '○';
        const label = conn ? 'CONNECTED' : busy ? 'CONNECTING…' : 'DISCONNECTED';

        const items = [
            { label: `${dot}  ${label}`, enabled: false },
        ];

        if (busy && this.#vpnType) {
            const detail = this.#server
                ? `${this.#vpnType}  ·  ${this.#server}`
                : this.#vpnType;
            items.push({ label: `     ${detail}`, enabled: false });
        }
        if (conn && this.#externalIp) {
            items.push({ label: `     IP: ${this.#externalIp}`, enabled: false });
        }
        if (!busy) {
            items.push({ label: '     Not connected', enabled: false });
        }

        items.push({ type: 'separator' });
        return items;
    }

    #profileItems() {
        const conn = this.#connStatus === connectionStates.connected;
        const busy = conn || this.#connStatus === connectionStates.connecting;

        if (!this.#profiles.length) {
            return [{ label: 'No profiles', enabled: false }];
        }

        return this.#profiles.map(p => {
            const isActive = p.id === this.#activeId && busy;
            const action   = isActive ? 'Disconnect' : 'Connect';
            return {
                label: `${isActive ? '●  ' : ''}${p.label}  —  ${action}`,
                click: () => isActive ? this.#onDisconnect() : this.#onConnect(p.id),
            };
        });
    }

    #rebuild() {
        const template = [
            // ── Status header (dark-area equivalent) ─────────────────────────
            ...this.#statusItems(),

            // ── Per-profile Connect / Disconnect ─────────────────────────────
            ...this.#profileItems(),
            { type: 'separator' },

            // ── App controls ─────────────────────────────────────────────────
            { label: 'Show VPNUK', click: () => this.#onShow() },
            {
                label: this.#inTaskbar ? 'Remove from Taskbar' : 'Show in Taskbar',
                click: () => this.#onToggleTaskbar(),
            },
            { type: 'separator' },

            // ── External links ───────────────────────────────────────────────
            { label: 'Live Help',        click: () => shell.openExternal(TAWK_URL)  },
            { label: 'Visit VPNUK',      click: () => shell.openExternal(VPNUK_URL) },
        ];

        this.#tray.setContextMenu(Menu.buildFromTemplate(template));
    }
}

module.exports = AppTray;
