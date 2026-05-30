import { makeAutoObservable, runInAction } from 'mobx';
import { v4 as uuid } from 'uuid';
import { optionsMtu, optionsAllowedIps, VpnType } from '@modules/constants.js';

class Profile {
    id = uuid();
    label = 'Label';
    vpnType = 'Type';

    // 'vpn' = direct VPN credentials (default), 'user' = VPNUK portal account
    accountType = 'vpn';

    credentials = {
        login: '',
        password: ''
    };

    // Portal (User Account) email + password — stored separately from VPN credentials
    userAccount = { email: '', password: '' };

    // Populated after a successful User Account sign-in
    // { id, status, isDedicated, type }
    userSubscription = null;

    serverType = 'shared';
    server = {
        host: '',
        label: 'Select server...'
    };
    details = {
        port: '1194',
        protocol: 'UDP',
        dns: { label: 'DNS: Default' },
        mtu: optionsMtu.find(o => o.value === ''),
        allowedIps: { ...optionsAllowedIps[0], customValue: '' },
        killSwitchEnabled: false
    };
    wgConfigFetched = false;

    constructor(label = 'New profile', vpnType = VpnType.OpenVPN.label) {
        makeAutoObservable(this);
        runInAction(() => {
            this.label = label;
            this.vpnType = vpnType;
        });
    }
};

export default Profile;
