const fs = require('fs');
const { settingsPath } = require('../../modules/constants');

exports.replaceVersionsEntry = (name, value) => {
    fs.writeFileSync(settingsPath.versions,
        JSON.stringify({
            ...JSON.parse(fs.readFileSync(settingsPath.versions)),
            [name]: value
        }, undefined, 2)
    );
};
