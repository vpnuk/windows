import { makeAutoObservable, action } from 'mobx';

class ConnectionLogStore {
    steps = [];
    error = '';

    constructor() {
        makeAutoObservable(this);
    }

    pushStep = action((msg) => {
        if (msg) this.steps.push(msg);
    });

    setError = action((msg) => {
        this.error = msg || '';
    });

    clear = action(() => {
        this.steps = [];
        this.error = '';
    });
}

export default new ConnectionLogStore();
