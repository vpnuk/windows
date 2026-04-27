const cp = require('child_process');
exports.spawnChild = async (command, args, options) => {
    const child = cp.spawn(command, args, options);

    let data = "";
    for await (const chunk of child.stdout) {
        data += chunk;
    }
    let error = "";
    for await (const chunk of child.stderr) {
        error += chunk;
    }
    const exitCode = await new Promise((resolve, _) => {
        child.on('close', resolve);
    });

    if (exitCode) {
        throw new Error(`Subprocess exited with error ${exitCode}:\n${error}`);
    }
    return data;
}