import { makeAutoObservable } from 'mobx';

class Servers {
    shared = [];
    dedicated = [];
    dedicated11 = [];

    constructor() {
        makeAutoObservable(this);
    }

    /**
     * @param {{ shared: any[]; dedicated: any[]; dedicated11: any[]; }} value
     */
    set values(value) {
        this.shared = value.shared;
        this.dedicated = value.dedicated;
        this.dedicated11 = value.dedicated11;
    }

    getCatalog(type) {
        return type === 'shared'
            ? this.shared
            : type === 'dedicated'
                ? this.dedicated
                : type === 'dedicated11'
                    ? this.dedicated11
                    : [];
    }

}

export default new Servers();