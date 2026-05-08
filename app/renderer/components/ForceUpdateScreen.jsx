import React from 'react';
import { Layout } from 'antd';
import ShieldImage from '@assets/shield.png';
import '@components/index.css';

const { shell } = require('electron');

const ForceUpdateScreen = ({ info }) => {
    const handleDownload = () => {
        shell.openExternal(info.url || 'https://vpnuk.net');
    };

    return (
        <div className="App">
            <Layout style={{ height: '100%' }}>
                <div className="wrapper-content">
                    <div className="column" />
                    <div className="column">
                        <div className="column-block column-image_world" />
                        <div className="column-block column-content_block">
                            <div className="starting-shield">
                                <img alt="vpnuk-shield" src={ShieldImage} />
                                <div style={{ textAlign: 'center', marginTop: 20, padding: '0 24px' }}>
                                    <div style={{ fontSize: 16, fontWeight: 600, color: '#d6e4f7', marginBottom: 10 }}>
                                        A newer version of VPNUK is available
                                    </div>
                                    <div style={{ fontSize: 13, color: '#6b8cad', marginBottom: 28, lineHeight: 1.6 }}>
                                        {info.message || 'Please download the latest version to continue.'}
                                    </div>
                                    <button
                                        onClick={handleDownload}
                                        style={{
                                            background: '#237be7',
                                            border: 'none',
                                            borderRadius: 45,
                                            color: '#fff',
                                            padding: '10px 28px',
                                            fontSize: 13,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            width: '100%',
                                            marginBottom: 10,
                                        }}
                                    >
                                        Download Latest Version
                                    </button>
                                    <button
                                        onClick={() => window.close()}
                                        style={{
                                            background: 'transparent',
                                            border: '1px solid #1e2d4a',
                                            borderRadius: 45,
                                            color: '#6b8cad',
                                            padding: '8px 28px',
                                            fontSize: 12,
                                            cursor: 'pointer',
                                            width: '100%',
                                        }}
                                    >
                                        Quit
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="column" />
                </div>
            </Layout>
        </div>
    );
};

export default ForceUpdateScreen;
