const { override, fixBabelImports, addBabelPlugin, addWebpackAlias } = require('customize-cra');
const ModuleScopePlugin = require('react-dev-utils/ModuleScopePlugin');
const path = require('path');
const fs = require('fs');

const pathAliases = {
    '@reducers': path.resolve(__dirname, '../renderer/reducers'),
    '@styles': path.resolve(__dirname, '../renderer/styles'),
    '@app': path.resolve(__dirname, '../renderer/App'),
    '@components': path.resolve(__dirname, '../renderer/components'),
    '@domain': path.resolve(__dirname, '../renderer/domain'),
};

const targetOverride = config => {
    config.target = 'electron-renderer';
    return config;
};

const modulesAliases = {
    '@assets': path.resolve(__dirname, '../assets'),
    '@modules': path.resolve(__dirname, '../modules')
};

const ModuleScopeExceptionOverride = config => {
    config.resolve.plugins.forEach(plugin => {
        if (plugin instanceof ModuleScopePlugin) {
            Object.values(modulesAliases).forEach(folder => 
                fs.readdirSync(folder)
                    .forEach(file =>
                        plugin.allowedFiles.add(
                            path.resolve(folder, file)))
            );
        }
    });
    return config;
};



module.exports = {
    paths: (paths, _) => {
        paths.appSrc = path.resolve(__dirname, '../renderer');
        paths.appIndexJs = path.resolve(__dirname, '../renderer/index.js');
        return paths
    },
    webpack: override(
        addWebpackAlias(modulesAliases),
        addWebpackAlias(pathAliases),
        ModuleScopeExceptionOverride,
        targetOverride,
        fixBabelImports('import',
            {
                libraryName: 'antd',
                libraryDirectory: 'es',
                style: 'css'
            }),
        addBabelPlugin('@babel/plugin-transform-modules-commonjs')
    )
};