import { makeAutoObservable } from 'mobx';

class ConnectionLogStore {
    steps      = [];
    error      = '';
    isExpired  = false;
    renewalUrl = '';

    constructor() {
        makeAutoObservable(this);
    }

    pushStep(msg) {
        if (msg) this.steps.push(msg);
    }

    setError(msg) {
        this.error      = msg || '';
        this.isExpired  = false;
        this.renewalUrl = '';
    }

    setSubscriptionExpired() {
        this.setSubscriptionExpiredWithUrl('https://www.vpnuk.net/my-account/subscriptions/');
    }

    setSubscriptionExpiredWithUrl(url) {
        this.error      = 'Your VPNUK subscription is no longer active.';
        this.isExpired  = true;
        this.renewalUrl = url || 'https://www.vpnuk.net/my-account/subscriptions/';
    }

    clear() {
        this.steps      = [];
        this.error      = '';
        this.isExpired  = false;
        this.renewalUrl = '';
    }
}

export default new ConnectionLogStore();
