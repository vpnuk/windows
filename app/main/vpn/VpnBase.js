const { getLogFileStream } = require('../utils/logs');

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
        this.type = profile.vpnType; // todo: convert to command types?
        this._server = profile.server;
        this._credentials = profile.credentials;
        this._dns = profile.details.dns;
        this._mtu = profile.details.mtu;
        this._logStream = getLogFileStream(profile.id);

        let { connectedHook, disconnectedHook, connectingHook, errorHook } = hooks;
        this._connectedHook = connectedHook;
        this._disconnectedHook = disconnectedHook;
        this._connectingHook = connectingHook;
        this._errorHook = errorHook;
    }
}

module.exports = VpnBase;