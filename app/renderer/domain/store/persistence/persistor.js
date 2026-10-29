import ElectronStore from 'electron-store';
import { autorun, runInAction, toJS } from 'mobx';
import migrate from './migrator';

const storage = new ElectronStore();

// Preserve the old JSON-string storage schema. Hydrate synchronously BEFORE
// starting the deep observer, otherwise defaults can overwrite saved profiles.
const persistor = (store, name, props) => {
    const saved = storage.get(name);
    if (saved !== undefined && saved !== null) {
        const migrated = migrate(name, typeof saved === 'string' ? saved : JSON.stringify(saved));
        const data = JSON.parse(migrated);
        runInAction(() => {
            props.forEach(prop => { if (data[prop] !== undefined) store[prop] = data[prop]; });
        });
    }
    const save = () => {
        const snapshot = {};
        props.forEach(prop => { snapshot[prop] = toJS(store[prop]); });
        // electron-store writes synchronously and atomically. No shutdown hook,
        // disconnect callback, timer or async hydration is needed for durability.
        storage.set(name, JSON.stringify(snapshot));
    };
    Object.defineProperty(store, 'saveNow', { value: save, enumerable: false });
    autorun(save, { onError: error => console.error(`Could not save ${name}:`, error.message) });
    return store;
};

export default persistor;