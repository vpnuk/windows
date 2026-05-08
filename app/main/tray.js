const { Menu, Tray, nativeImage } = require('electron');
const { connectionStates } = require('../modules/constants');
const path = require('path');

const _icons = { // connectionStates
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

const contextMenuTemplate = [
    { id: 'show', label: tooltipBase, type: 'normal', click: () => { } },
    { id: 'status', label: 'Status: Disconnected', type: 'normal', enabled: false },
    { label: 'Quit', role: 'quit' }
];

class AppTray {
    constructor(windowFocus = null) {
        this.#tray = new Tray(icons[connectionStates.disconnected]);
        if (windowFocus) {
            contextMenuTemplate
                .find(item => item.id === 'show')
                .click = windowFocus;
        }
        this.#tray.setContextMenu(
            Menu.buildFromTemplate(contextMenuTemplate));
        this.#tray.setToolTip(tooltipBase);
    }

    setConnectedState = message =>
        this.#setTrayState(connectionStates.connected, message);

    setDisconnectedState = message =>
        this.#setTrayState(connectionStates.disconnected, message);

    setConnectingState = message =>
        this.#setTrayState(connectionStates.connecting, message);

    // Update icon/tooltip/menu without showing a balloon notification.
    setStateSilent = (state, message) =>
        this.#updateState(state, message);

    // Show a balloon notification without changing the tray icon or tooltip.
    notify = (title, content, state = connectionStates.disconnected) => {
        this.#tray.displayBalloon({
            iconType: 'custom',
            icon: iconPaths[state],
            title,
            content
        });
    };

    #tray = null;

    #updateState = (state, message) => {
        const text = `${tooltipBase}: ${message}`;
        this.#tray.setImage(icons[state]);
        this.#tray.setToolTip(text);
        contextMenuTemplate
            .find(item => item.id === 'status')
            .label = `Status: ${message}`;
        this.#tray.setContextMenu(
            Menu.buildFromTemplate(contextMenuTemplate));
    };

    #setTrayState = (state, message) => {
        this.#updateState(state, message);
        this.#tray.displayBalloon({
            iconType: 'custom',
            icon: iconPaths[state],
            title: `${tooltipBase}: ${message}`,
            content: message
        });
    };
}

module.exports = AppTray;
