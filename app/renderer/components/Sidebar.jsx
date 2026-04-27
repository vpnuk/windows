import React from 'react';
import { observer } from 'mobx-react-lite';
import { Drawer } from 'antd';
import '@components/index.css';
import ShieldImage from '@assets/icon.png';
import { Menu } from '@components';

const Sidebar = observer(({ visible, setVisible }) =>
    <Drawer
        title={<SettingsTitle />}
        placement="left"
        onClose={() => setVisible(false)}
        visible={visible}
        width={522}
        closable
        headerStyle={{ background: '#0d1422', borderBottom: '1px solid #1e2d4a' }}
        drawerStyle={{ background: '#0d1422' }}>

        <Menu />
    </Drawer>
);

const SettingsTitle = () => (
    <div className="settings-button-modal">
        <img alt="vpnuk-logo" src={`${ShieldImage}`} style={{ width: 32, height: 32, filter: 'none' }} />
        <div>
            <p>VPNUK Settings</p>
        </div>
    </div>
);

export default Sidebar;
