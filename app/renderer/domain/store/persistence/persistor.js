import ElectronStore from 'electron-store';
import { StorageAdapter, persistence } from 'mobx-persist-store';
import migrate from './migrator';

const storage = new ElectronStore();

function readStore(name) {
    return new Promise((resolve) => {
        let data = storage.get(name);
        data = migrate(name, data);
        resolve(data);
    });
}

function writeStore(name, content) {
    return new Promise((resolve) => {
        storage.set(name, content);
        resolve();
    });
}

const persistAdapter = new StorageAdapter({
    read: readStore,
    write: writeStore,
});

const persistor = (store, name, props) => persistence({
    name: name,
    properties: props,
    adapter: persistAdapter,
}, false)(store);

export default persistor;