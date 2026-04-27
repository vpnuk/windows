import { makeAutoObservable } from 'mobx';
import { connectionStates } from '@modules/constants.js';

class ConnectionStore {
    state = connectionStates.disconnected;
    gateway = null;
    
    constructor() {
        makeAutoObservable(this);
    }
};

export default new ConnectionStore();