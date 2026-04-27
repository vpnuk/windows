import React, { useEffect, useState } from 'react';

const LoadingGate = ({ children, loading }) => {
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // setTimeout(() => { setIsLoading(false); }, 2500);
        setIsLoading(false);
    }, []);

    return isLoading ? <>{loading}</> : <>{children}</>;
};

export default LoadingGate;