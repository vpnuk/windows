'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

async function main() {
    // Even if signing credentials were mistakenly present, explicit unsigned mode
    // must return before either signing hook launches an external process.
    for (const filename of ['sign.js', 'afterPack.js']) {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), {
            module, exports: module.exports, console: { log() {} },
            process: { env: { VPNUK_UNSIGNED: 'true', CST_BAT: 'must-not-run', CST_DIR: 'must-not-run', CODE_SIGN_TOOL_PATH: 'must-not-run' } },
            require(id) {
                if (id === 'child_process') return {
                    spawnSync() { throw new Error('Unsigned build attempted signing'); },
                    execFileSync() { throw new Error('Unsigned build attempted signing'); },
                };
                return require(id);
            },
        }, { filename });
        await (filename === 'sign.js' ? module.exports({ path: 'test.exe' }) : module.exports.default({}));
        console.log(`PASS ${filename} blocks signing in unsigned mode`);
    }
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
    const steps = workflow.split(/\r?\n      - name: /).slice(1);
    for (const name of ['Download CodeSignTool', 'Build NSIS installers', 'Sign installer wrappers with eSigner', 'Verify installer signatures']) {
        const step = steps.find(value => value.startsWith(name));
        assert(step && step.includes("if: env.BUILD_SIGNED == 'true'"), `${name} must be signed-only`);
    }
    const unsigned = steps.find(value => value.startsWith('Build unsigned private NSIS installer'));
    assert(unsigned && !/secrets\.|CST_BAT:|CST_DIR:|ESIGNER_/.test(unsigned), 'Unsigned packaging must receive no signing credentials');
    assert(workflow.includes("github.event_name == 'workflow_dispatch' && github.event.inputs.signed == 'true'"));
    assert(workflow.includes("Public releases require an explicitly selected signed build."));
    assert(workflow.includes('Remove-Item ".\\release\\latest.yml"'));
    assert(workflow.includes('--draft'));
    console.log('PASS workflow isolates paid signing and unsigned drafts');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
