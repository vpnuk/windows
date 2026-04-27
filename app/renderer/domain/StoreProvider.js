import React from 'react';
import { RootStore } from '@domain';

const StoreContext = React.createContext();

export const StoreProvider = ({ children }) => {
    const store = new RootStore();
    return (
        <StoreContext.Provider value={store}>
            {children}
        </StoreContext.Provider>
    );
};

export const useStore = () => {
    const store = React.useContext(StoreContext);
    if (!store) {
        throw new Error('useStore must be used within a StoreProvider.');
    }
    return store;
};
