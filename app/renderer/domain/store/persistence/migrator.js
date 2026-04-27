import { VpnType } from '@modules/constants.js';
import { createDefaultProfiles } from '../ProfileStore';

function migrate(name, data) {
    if (name === 'profiles') {
        let entity = JSON.parse(data);
        if (entity.profiles.constructor === Array) {
            let profiles = createDefaultProfiles();
            profiles[VpnType.OpenVPN.label] = entity.profiles;
            return JSON.stringify({ profiles: profiles }, undefined, 0);
        }
    }
    return data;
};

export default migrate;