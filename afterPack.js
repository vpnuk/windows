'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

/**
 * afterPack hook – called by electron-builder after each arch is packaged
 * but BEFORE the NSIS installer is assembled.  Signs the main app .exe so
 * it carries the EV cert when extracted to the user's machine.
 */
exports.default = async function afterPack(context) {
  const cstDir = process.env.CODE_SIGN_TOOL_PATH;
  if (!cstDir) {
    console.log('[afterPack] CODE_SIGN_TOOL_PATH not set – skipping app exe signing');
    return;
  }

  const productName = context.packager.appInfo.productFilename;
  const exePath     = path.join(context.appOutDir, `${productName}.exe`);

  if (!fs.existsSync(exePath)) {
    console.log(`[afterPack] ${exePath} not found – skipping`);
    return;
  }

  console.log(`[afterPack] Signing ${exePath}`);

  const bat = path.join(cstDir, 'CodeSignTool.bat');
  // spawnSync with an argument array avoids shell-quoting issues.
  // Paths inside win-unpacked/ have no spaces so no special quoting needed.
  const result = spawnSync(
    bat,
    [
      'sign',
      `-username=${process.env.ESIGNER_USERNAME}`,
      `-password=${process.env.ESIGNER_PASSWORD}`,
      `-credential_id=${process.env.ESIGNER_CREDENTIAL_ID}`,
      `-totp_secret=${process.env.ESIGNER_TOTP_SECRET}`,
      `-input_file_path=${exePath}`,
      '-override=true',
    ],
    { cwd: cstDir, stdio: 'inherit', shell: true }
  );

  if (result.status !== 0) {
    throw new Error(`[afterPack] Signing failed for ${path.basename(exePath)} (exit ${result.status})`);
  }
  console.log(`[afterPack] Signed OK: ${path.basename(exePath)}`);
};
