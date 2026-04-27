import React from 'react';
import { observer } from 'mobx-react-lite';
import { Layout, Progress } from 'antd';
import WorldImage from '@assets/world.png';
import '@components/index.css';
import { useStore } from '@domain';

const UpdateInfo = observer(() => {
    const settings = useStore().settings;

    return (
        <div className="App">
            <Layout style={{ height: "100%" }}>
                <div className="wrapper-content">
                    <div className="column" style={{ width: '100%', padding: '5%' }}>
                        <div className="column-image_world">
                            <img alt="world-img" src={`${WorldImage}`} />
                        </div>
                        <div className="column-content_block">
                            <div className="column-content_block-title">UPDATE</div>
                            <Progress
                                type="line"
                                status="active"
                                width={192}
                                strokeWidth={16}
                                strokeColor={{
                                    '0%': '#1ACEB8',
                                    '100%': '#1ACEB8',
                                }}
                                strokeLinecap="round"
                                percent={(settings.update.progress?.percent ?? 0.0) | 0}
                                style={{ marginTop: 15 }}
                            />
                            <div className="column-content_block-update_text">
                                <h1>Release: {settings.update.info?.releaseName}</h1>
                                <div dangerouslySetInnerHTML={{ __html: settings.update.info?.releaseNotes }} />
                            </div>
                        </div>
                    </div>
                </div>
            </Layout>
        </div>
    );
});

export default UpdateInfo;