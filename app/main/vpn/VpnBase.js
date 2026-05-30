const { getLogFileStream } = require('../utils/logs');

const DEFAULT_DNS = { label: 'DNS: Default' };
const DEFAULT_MTU = { value: '', label: 'MTU: Default' };

class VpnBase {
    constructor(profile, hooks) {
        if (new.target === VpnBase) {
            throw new TypeError('Cannot construct Abstract instances directly');
        }
        if (this.connect === undefined
            || this.disconnect === undefined
            || this.getConnectionStatus === undefined) {

            throw new TypeError("Must override method");
        }

        this._name = `VPNUK-${profile.vpnType}`;
        this.type = profile.vpnType;
        this._server = profile.server;
        this._credentials = profile.credentials;
        // profile.details may be undefined on profiles saved by older builds
        this._dns = profile.details?.dns ?? DEFAULT_DNS;
        this._mtu = profile.details?.mtu ?? DEFAULT_MTU;
        this._logStream = getLogFileStream(profile.id);

        let { connectedHook, disconnectedHook, connectingHook, errorHook } = hooks;
        this._connectedHook = connectedHook;
        this._disconnectedHook = disconnectedHook;
        this._connectingHook = connectingHook;
        this._errorHook = errorHook;
    }
}

module.exports = VpnBase;
