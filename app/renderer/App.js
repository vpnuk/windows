import React, { useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import { autorun, runInAction, toJS } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Layout } from 'antd';
import './app.css';
import { modalStyle } from '@styles';
import { Sidebar, MainPage, UpdateInfo, Starting, ForceUpdateScreen } from '@components';
import {
    checkOvpnUpdates,
    downloadOvpnUpdate,
    downloadPatchedOvpnExe,
    initializeCatalogs,
    isObfuscateAvailable,
    downloadWireGuardInstaller
} from '@modules/catalogs.js';
import {
    Dns,
    Servers,
    OvpnOptions,
    ConnectionStore,
    useStore,
    WvpnOptions
} from '@domain';
import scheduler, { HOUR_MS } from '@modules/scheduler.js';
const { ipcRenderer } = require('electron');
const { ensureWgConfig } = require('./components/wgApi');

let isDev, store;

/* Auto-connect retry state — cleared on success or cancel */
let acRetryCount = 0;
let acRetryTimer = null;
const AC_MAX_RETRIES  = 3;
const AC_RETRY_DELAY  = 30_000; /* ms */

/* Tray state */
let trayAutorunDisposer = null;
let pendingTrayConnectId = null;

function acScheduleRetry() {
    clearTimeout(acRetryTimer);
    acRetryTimer = setTimeout(() => {
        if (!store?.settings?.autoConnectWaiting) return;
        if (acRetryCount >= AC_MAX_RETRIES) {
            runInAction(() => {
                store.settings.autoConnectWaiting = false;
                store.settings.autoConnect = false;
            });
            return;
        }
        acRetryCount++;
        ipcRenderer.send('default-gateway-request');
    }, AC_RETRY_DELAY);
}

function acCancelRetry() {
    clearTimeout(acRetryTimer);
    acRetryTimer = null;
    acRetryCount = 0;
}

// ── Tray connect helper ───────────────────────────────────────────────────────
async function doTrayConnect(profile, gateway) {
    if (!profile?.server?.host) {
        // Auto-init server if not set
        const catalog = Servers.getCatalog(profile.serverType || 'shared');
        if (catalog.length > 0) {
            runInAction(() => { profile.server = catalog[0]; });
        }
    }
    if (!profile?.server?.host) return;

    const plainProfile = toJS(profile);
    const plainWvpn    = toJS(WvpnOptions);

    if (plainProfile.vpnType === 'WireGuard') {
        const result = await ensureWgConfig(plainProfile, () => {}).catch(() => ({ success: false }));
        if (!result.success) return;
        runInAction(() => { profile.wgConfigFetched = !profile.wgConfigFetched; });
    }

    ipcRenderer.send('connection-start', { profile: plainProfile, gateway, wVpnOptions: plainWvpn });
}

// ─── Startup ─────────────────────────────────────────────────────────────────

const App = observer(() => {
    const [ready, setReady] = useState(false);
    const [forceUpdateInfo, setForceUpdateInfo] = useState(null);
    const [startError, setStartError] = useState(null);
    const [startMessage, setStartMessage] = useState('Starting...');
    const [notification, setNotification] = useState(null);

    const innerStore = useStore();
    store = innerStore;

    useEffect(() => {
        initializeCatalogs()
            .then(async catalog => {
                if (catalog.forceUpdate?.minVersion) {
                    const appVer = await ipcRenderer.invoke('get-version');
                    if (semverBelow(appVer, catalog.forceUpdate.minVersion)) {
                        setForceUpdateInfo(catalog.forceUpdate);
                        return;
                    }
                }
                isDev && console.log('initializeCatalogs', catalog);
                ipcRenderer.send('ikev2-cert-install', catalog.installIKEv2Cert);
                runInAction(() => {
                    Dns.values = catalog.dns;
                    Servers.values = catalog.servers;
                    OvpnOptions.isObfuscateAvailable = catalog.isObfuscateAvailable;
                    WvpnOptions.ipseckey = catalog.ipseckey;
                });

                if (catalog.wgInstaller) {
                    ipcRenderer.send('wg-update-request', { installer: catalog.wgInstaller });
                }

                setReady(true);

                // ── Tray profile sync ─────────────────────────────────────────
                // Keep the main-process tray menu and Jump List in sync with the
                // MobX profile store.  Re-runs automatically whenever any profile
                // label/type changes or the active profile changes.
                if (trayAutorunDisposer) trayAutorunDisposer();
                trayAutorunDisposer = autorun(() => {
                    const allProfiles = Object.keys(innerStore.profiles.profiles).flatMap(vt =>
                        innerStore.profiles.profiles[vt].map(p => ({
                            id:      p.id,
                            label:   p.label,
                            vpnType: p.vpnType,
                        }))
                    );
                    ipcRenderer.send('tray-state-update', {
                        profiles:        allProfiles,
                        activeProfileId: innerStore.settings.profileId,
                    });
                });

                if (innerStore.settings.autoConnect) {
                    setTimeout(() => {
                        ipcRenderer.send('default-gateway-request');
                    }, 500);
                }

                window.addEventListener('online', () => {
                    if (store?.settings?.autoConnect && store?.settings?.autoConnectWaiting) {
                        ipcRenderer.send('default-gateway-request');
                    }
                }, { once: false });

                ovpnCheckUpdate();
                scheduler.schedule('ovpn-check-update', ovpnCheckUpdate, 72 * HOUR_MS);
            })
            .catch(err => {
                isDev && console.error('initializeCatalogs error', err);
                if (err?.message === 'OFFLINE_NO_CACHE') {
                    setStartMessage('No internet connection and no cached data available.');
                    setStartError('error');
                } else {
                    setStartMessage('Server list could not be refreshed — using cached data.');
                    setStartError('warning');
                    setReady(true);
                }
            });

        ipcRenderer.send('is-dev-request');
        ipcRenderer.send('default-gateway-request');
        ipcRenderer.send('ipv6-fix');
        ipcRenderer.send('auto-update-enable');

        return () => {
            if (trayAutorunDisposer) { trayAutorunDisposer(); trayAutorunDisposer = null; }
        };
    }, []);

    // Show notification from main process
    useEffect(() => {
        const handler = (_, msg) => {
            setNotification(msg);
            setTimeout(() => setNotification(null), 6000);
        };
        ipcRenderer.on('app-notification', handler);
        return () => ipcRenderer.removeListener('app-notification', handler);
    }, []);

    const [isSidebarVisible, setSidebarVisible] = useState(false);
    const showDrawer = () => setSidebarVisible(true);

    if (!ready) {
        return <Starting message={startMessage} type={startError || 'loading'} />;
    }

    return (
        <div className="App" id="app">
            {notification && (
                <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 9999, maxWidth: 340 }}>
                    <div className={`app-notification app-notification--${notification.type || 'info'}`}>
                        <span className="app-notification-icon">
                            {notification.type === 'error' ? '🔴' : notification.type === 'warning' ? '⚠️' : 'ℹ️'}
                        </span>
                        <div className="app-notification-body">
                            {notification.title && <h4>{notification.title}</h4>}
                            <p>{notification.message}</p>
                        </div>
                    </div>
                </div>
            )}
            <Layout style={{ height: "100%" }}>
                <Sidebar
                    visible={isSidebarVisible}
                    setVisible={setSidebarVisible} />
                <Layout>
                    <MainPage showDrawer={showDrawer} />
                </Layout>
            </Layout>
            <Modal
                isOpen={innerStore.settings.isModalOpen}
                closeTimeoutMS={200}
                style={modalStyle}
            >
                <UpdateInfo />
            </Modal>

            <Modal
                isOpen={innerStore.settings.autoConnectWaiting}
                closeTimeoutMS={200}
                style={{
                    ...modalStyle,
                    content: {
                        ...modalStyle.content,
                        top: '50%', left: '50%',
                        right: 'auto', bottom: 'auto',
                        transform: 'translate(-50%, -50%)',
                        padding: '28px 32px',
                        textAlign: 'center',
                        minWidth: 280,
                    }
                }}
            >
                <div style={{ color: '#d6e4f7' }}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                        Auto Connect Enabled
                    </div>
                    <div style={{ fontSize: 13, color: '#6b8cad', marginBottom: 24, lineHeight: 1.5 }}>
                        Waiting for an active internet connection&hellip;
                        <br />
                        <span style={{ fontSize: 11, color: '#3d5a7a' }}>
                            Will retry up to {AC_MAX_RETRIES} times every {AC_RETRY_DELAY / 1000}s
                        </span>
                    </div>
                    <button
                        onClick={() => { acCancelRetry(); runInAction(() => { store.settings.autoConnectWaiting = false; store.settings.autoConnect = false; }); }}
                        style={{
                            background: 'transparent',
                            border: '1px solid #1e2d4a',
                            borderRadius: 45,
                            color: '#6b8cad',
                            padding: '6px 24px',
                            fontSize: 13,
                            cursor: 'pointer',
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </Modal>
        </div>
    );
});

function semverBelow(version, minVersion) {
    const v = String(version).split('.').map(Number);
    const m = String(minVersion).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const vi = v[i] || 0;
        const mi = m[i] || 0;
        if (vi < mi) return true;
        if (vi > mi) return false;
    }
    return false;
}

function ovpnCheckUpdate() {
    checkOvpnUpdates().then(info => {
        info && ipcRenderer.send('ovpn-update-request', info);
    });
}

Modal.setAppElement('#root');

// ─── IPC listeners ────────────────────────────────────────────────────────────

ipcRenderer.on('is-dev-response', (_, arg) => {
    isDev = arg;
    exports.isDev = isDev;
});

ipcRenderer.on('default-gateway-response', (_, arg) => {
    isDev && console.log('default-gateway-response', arg);
    runInAction(() => {
        ConnectionStore.gateway = arg;
    });

    // ── Pending tray connect ──────────────────────────────────────────────────
    if (pendingTrayConnectId && arg) {
        const connectId = pendingTrayConnectId;
        pendingTrayConnectId = null;
        for (const vt of Object.keys(store.profiles.profiles)) {
            const p = store.profiles.profiles[vt].find(pr => pr.id === connectId);
            if (p) { doTrayConnect(p, arg); break; }
        }
        return; // don't fall through to auto-connect logic
    }

    // ── Auto connect ──────────────────────────────────────────────────────────
    if (store?.settings?.autoConnect && ConnectionStore.state === 'Disconnected') {
        if (arg) {
            acCancelRetry();
            runInAction(() => { store.settings.autoConnectWaiting = false; });
            const profile = store.profiles.currentProfile;
            if (profile && !profile.server?.host) {
                const catalog = Servers.getCatalog(profile.serverType || 'shared');
                if (catalog.length > 0) {
                    runInAction(() => { profile.server = catalog[0]; });
                }
            }
            if (profile?.server?.host) {
                const plainProfile = toJS(profile);
                const plainWvpn    = toJS(WvpnOptions);

                const doAutoConnect = async () => {
                    if (plainProfile.vpnType === 'WireGuard') {
                        const result = await ensureWgConfig(plainProfile, () => {}).catch(err => ({
                            success: false, error: err.message
                        }));
                        if (!result.success) {
                            isDev && console.error('auto-connect WG config failed:', result.error);
                            return;
                        }
                        runInAction(() => { profile.wgConfigFetched = !profile.wgConfigFetched; });
                    }

                    ipcRenderer.send('connection-start', {
                        profile:     plainProfile,
                        gateway:     arg,
                        wVpnOptions: plainWvpn,
                    });
                };

                doAutoConnect();
            }
        } else {
            runInAction(() => { store.settings.autoConnectWaiting = true; });
            acScheduleRetry();
        }
    }
});

ipcRenderer.on('connection-changed', (_, arg) => {
    isDev && console.log('connection-changed', arg);
    runInAction(() => {
        ConnectionStore.state = arg;
        if (arg !== 'Disconnected' && store?.settings?.autoConnectWaiting) {
            acCancelRetry();
            store.settings.autoConnectWaiting = false;
        }
    });
});

// ── Tray connect / disconnect triggered by tray menu click ────────────────────

ipcRenderer.on('tray-connect', (_, { profileId }) => {
    if (!store) return;
    // Find the profile across all vpnTypes
    let found = null;
    for (const vt of Object.keys(store.profiles.profiles)) {
        const p = store.profiles.profiles[vt].find(pr => pr.id === profileId);
        if (p) { found = { profile: p, vpnType: vt }; break; }
    }
    if (!found) return;

    // Switch the UI to the correct vpnType and profile
    runInAction(() => {
        store.settings.vpnType = found.vpnType;
        store.settings.profileId = profileId;
    });

    const gateway = ConnectionStore.gateway;
    if (gateway) {
        doTrayConnect(found.profile, gateway);
    } else {
        pendingTrayConnectId = profileId;
        ipcRenderer.send('default-gateway-request');
    }
});

ipcRenderer.on('tray-disconnect', () => {
    ipcRenderer.send('connection-stop');
});

// ─────────────────────────────────────────────────────────────────────────────

ipcRenderer.on('ovpn-update-response', async (event, arg) => {
    isDev && console.log('ovpn-update-response', arg);
    runInAction(() => { OvpnOptions.isObfuscateAvailable = false; });
    Promise.all([
        downloadOvpnUpdate(arg.original),
        downloadPatchedOvpnExe(arg.patch)
    ]).then(result => event.sender.send('ovpn-update-install', { info: arg, file: result[0] }));
});

ipcRenderer.on('ovpn-update-installed', (_, arg) => {
    isDev && console.log('ovpn-update-installed', arg);
    runInAction(() => { OvpnOptions.isObfuscateAvailable = isObfuscateAvailable(); });
});

ipcRenderer.on('auto-update-info', (_, arg) => {
    isDev && console.log('auto-update-info', arg);
    store.settings.update.info = arg;
    store.settings.toggleModal();
});

ipcRenderer.on('auto-update-progress', (_, arg) => {
    isDev && console.log('auto-update-progress', arg);
    runInAction(() => { store.settings.update.progress = arg; });
});

ipcRenderer.on('ikev2-cert-installed', (_, arg) => {
    isDev && console.log('ikev2-cert-installed', arg);
    runInAction(() => { WvpnOptions.ikeCertOk = arg; });
});

window.addEventListener('beforeunload', _ => {
    isDev && console.log('window beforeunload');
    runInAction(() => { store.triggerPersist(); });
});

export default App;
