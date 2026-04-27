import { makeAutoObservable } from 'mobx';

class WvpnOptions {
    ipseckey = null;
    ikeCertOk = false;

    constructor() {    
        makeAutoObservable(this);
    }
};

export default new WvpnOptions();
