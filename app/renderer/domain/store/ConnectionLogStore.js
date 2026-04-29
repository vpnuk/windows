import { makeAutoObservable } from 'mobx';

class ConnectionLogStore {
    steps = [];
    error = '';

    constructor() {
        makeAutoObservable(this);
    }

    pushStep(msg) {
        if (msg) this.steps.push(msg);
    }

    setError(msg) {
        this.error = msg || '';
    }

    clear() {
        this.steps = [];
        this.error = '';
    }
}

export default new ConnectionLogStore();
