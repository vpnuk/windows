import React from 'react';
import { Layout } from 'antd';
import ShieldImage from '@assets/shield.png';
import '@components/index.css';

const Starting = ({ message = 'Starting...', type = 'loading' }) => {
    return (
        <div className="App">
            <Layout style={{ height: "100%" }}>
                <div className="wrapper-content">
                    <div className="column"></div>
                    <div className="column">
                        <div className="column-block column-image_world">
                        </div>
                        <div className="column-block column-content_block">
                            <div className="starting-shield">
                                <img alt="vpnuk-shield" src={`${ShieldImage}`} />
                                <span className="starting-text">{message}</span>
                                {type === 'warning' && (
                                    <div className="app-notification app-notification--warning" style={{ maxWidth: 340, width: '100%' }}>
                                        <span className="app-notification-icon">⚠️</span>
                                        <div className="app-notification-body">
                                            <h4>No internet connection</h4>
                                            <p>Could not reach the update server. The app will continue with cached settings.</p>
                                        </div>
                                    </div>
                                )}
                                {type === 'error' && (
                                    <div className="app-notification app-notification--error" style={{ maxWidth: 340, width: '100%' }}>
                                        <span className="app-notification-icon">🔴</span>
                                        <div className="app-notification-body">
                                            <h4>Connection issue</h4>
                                            <p>Unable to load server list. Check your internet connection and try again.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="column"></div>
                </div>
            </Layout>
        </div>
    );
}

export default Starting;
