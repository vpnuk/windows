import { makeAutoObservable, toJS } from 'mobx';
import { Profile } from '@domain';
import { VpnType } from '@modules/constants.js';

const defaultProfileName = 'default';

function _createDefaultProfiles() {
    return Object.assign({}, ...Object.entries(VpnType).map(([k, _]) => ({
        [k]: [new Profile(`${k} ${defaultProfileName}`, k)]
    })));
}
export const createDefaultProfiles = _createDefaultProfiles;

class ProfileStore {
    profiles = _createDefaultProfiles();

    constructor(settings) {
        this.settings = settings;
        makeAutoObservable(this, { settings: false });
    }

    getProfiles(vpnType = this.settings.vpnType) {
        return this.profiles[vpnType];
    }

    getProfile(id, vpnType = this.settings.vpnType) {
        let list =this.profiles[vpnType];
        return list.find(p => p.id === id) || list[0];
    }

    createProfile(name, vpnType = this.settings.vpnType) {
        let newProfile = new Profile(name, vpnType);
        this.profiles[vpnType].push(newProfile);
        this.settings.profileId = newProfile.id;
    }

    deleteProfile(id, vpnType = this.settings.vpnType) {
        let list = this.profiles[vpnType];
        let index = toJS(list).findIndex(p => p.id === id);
        list.splice(index, 1);
        if (!list.length) {
            this.createProfile(`${vpnType} ${defaultProfileName}`, vpnType);
            return;
        }
        index = index - 1 < 0 ? 0 : index - 1;
        this.settings.profileId = list[index].id;
    }

    get currentProfile() {
        return this.getProfile(this.settings.profileId);
    }
};

export default ProfileStore;