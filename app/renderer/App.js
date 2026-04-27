import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Layout } from 'antd';
import './app.css';
import { modalStyle } from '@styles';
import { Sidebar, MainPage, UpdateInfo, Starting } from '@components';
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

let isDev, store;

// ─── Startup ─────────────────────────────────────────────────────────────────

const App = observer(() => {
    const [ready, setReady] = useState(false);
    const [startError, setStartError] = useState(null); // null | 'warning' | 'error'
    const [startMessage, setStartMessage] = useState('Starting...');
    const [notification, setNotification] = useState(null);

    const innerStore = useStore();
    store = innerStore;

    useEffect(() => {
        initializeCatalogs()
            .then(catalog => {
                isDev && console.log('initializeCatalogs', catalog);
                ipcRenderer.send('ikev2-cert-install', catalog.installIKEv2Cert);
                runInAction(() => {
                    Dns.values = catalog.dns;
                    Servers.values = catalog.servers;
                    OvpnOptions.isObfuscateAvailable = catalog.isObfuscateAvailable;
                    WvpnOptions.ipseckey = catalog.ipseckey;
                });

                // Trigger WireGuard installer if needed
                if (catalog.wgInstaller) {
                    ipcRenderer.send('wg-update-request', { installer: catalog.wgInstaller });
                }

                setReady(true);

                // Auto-connect after ready if enabled
                if (innerStore.settings.autoConnect) {
                    setTimeout(() => {
                        ipcRenderer.send('default-gateway-request');
                    }, 500);
                }
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
        ovpnCheckUpdate();
        scheduler.schedule('ovpn-check-update', ovpnCheckUpdate, 72 * HOUR_MS);
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
        </div>
    );
});

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
    // Auto-connect if enabled and we just got gateway
    if (store?.settings?.autoConnect && ConnectionStore.state === 'Disconnected') {
        const profile = store.profiles.currentProfile;
        if (profile?.server?.host) {
            ipcRenderer.send('connection-start', {
                profile,
                gateway: arg,
                wVpnOptions: { ipseckey: WvpnOptions.ipseckey }
            });
        }
    }
});

ipcRenderer.on('connection-changed', (_, arg) => {
    isDev && console.log('connection-changed', arg);
    runInAction(() => { ConnectionStore.state = arg; });
});

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
