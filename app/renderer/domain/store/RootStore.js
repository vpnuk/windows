import { makeAutoObservable } from 'mobx';
import { ProfileStore, SettingsStore } from '@domain';
import persistor from './persistence/persistor';

class RootStore {
    constructor() {
        this.settings = persistor(
            new SettingsStore(),
            'settings',
            ['vpnType', 'profileId', 'autoConnect', 'autoRun']);
        this.profiles = persistor(
            new ProfileStore(this.settings),
            'profiles',
            ['profiles']);
        makeAutoObservable(this);
    }

    triggerPersist() {
        this.profiles.saveNow();
        this.settings.saveNow();
    }
}

export default RootStore;