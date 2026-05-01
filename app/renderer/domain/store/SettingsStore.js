import { makeAutoObservable } from 'mobx';
import { VpnType } from '@modules/constants.js';

class SettingsStore {
    vpnType = VpnType.WireGuard.label;
    profileId = '';
    isModalOpen = false;
    autoConnect = false;
    autoRun = false;
    autoConnectWaiting = false; /* true while waiting for internet on startup — never persisted */
    update = {
        info: null,
        progress: null
    };

    constructor() {
        makeAutoObservable(this);
    }

    toggleModal() {
        this.isModalOpen = !this.isModalOpen;
    }
}

export default SettingsStore;
