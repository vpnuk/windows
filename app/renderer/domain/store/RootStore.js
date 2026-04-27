import { makeAutoObservable, toJS } from 'mobx';
import { ProfileStore, SettingsStore } from '@domain';
import persistor from './persistence/persistor';

class RootStore {
    constructor() {
        this.settings = persistor(
            new SettingsStore(),
            'settings',
            ['vpnType', 'profileId']);
        this.profiles = persistor(
            new ProfileStore(this.settings),
            'profiles',
            ['profiles']);
        makeAutoObservable(this);
    }

    triggerPersist() {
        this.profiles.profiles = toJS(this.profiles.profiles);
    }
}

export default RootStore;