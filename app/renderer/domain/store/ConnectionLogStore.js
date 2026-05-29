import { makeAutoObservable } from 'mobx';

class ConnectionLogStore {
    steps      = [];
    error      = '';
    isExpired  = false;

    constructor() {
        makeAutoObservable(this);
    }

    pushStep(msg) {
        if (msg) this.steps.push(msg);
    }

    setError(msg) {
        this.error     = msg || '';
        this.isExpired = false;
    }

    setSubscriptionExpired() {
        this.error     = 'Your VPNUK subscription is no longer active.';
        this.isExpired = true;
    }

    clear() {
        this.steps     = [];
        this.error     = '';
        this.isExpired = false;
    }
}

export default new ConnectionLogStore();
