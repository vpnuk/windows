import { makeAutoObservable } from 'mobx';

const data = new Map([
    ['TCP', { value: 'tcp', ports: ['443', '80', '8008'] }],
    ['UDP', { value: 'udp', ports: ['1194', '55194', '65194'] }],
    ['Obfuscation', { value: 'tcp', ports: ['443'] }]
]);

class OvpnOptions {
    isObfuscateAvailable = false;

    constructor() {
        makeAutoObservable(this);
    }

    get protocolNames() {
        return this.isObfuscateAvailable
            ? [...data.keys()]
            : [...data.keys()].filter(k => k !== 'Obfuscation');
    }

    getPorts(protocol) {
        return data.get(protocol).ports;
    }

    getProtocolValue(protocol) {
        return data.get(protocol).value;
    }
};

export default new OvpnOptions();