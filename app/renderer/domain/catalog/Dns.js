import { makeAutoObservable } from 'mobx';

class Dns {
    values = [];

    constructor() {    
        makeAutoObservable(this);
    }
};

export default new Dns();