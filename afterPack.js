'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

/**
 * afterPack hook – called by electron-builder after each arch is packaged
 * but BEFORE the NSIS installer is assembled.  Signs the main app .exe so
 * it carries the EV cert when extracted to the user's machine.
 *
 * Root-cause note: CodeSignTool writes the signed output to its working
 * directory by default, NOT back to the input path.  We therefore use an
 * explicit -output_dir_path (a fresh temp dir), then copy the signed file
 * back over the original so NSIS packages the signed version.
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

  const originalSize = fs.statSync(exePath).size;
  console.log(`[afterPack] Signing ${exePath}  (${(originalSize/1024/1024).toFixed(1)} MB)`);

  // Use an explicit temp output dir so the signed copy always lands in a known place.
  // Without -output_dir_path CodeSignTool writes to its OWN working dir (cstDir),
  // leaving the original in win-unpacked unsigned.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cst-out-'));

  try {
    const bat = path.join(cstDir, 'CodeSignTool.bat');
    const result = spawnSync(
      bat,
      [
        'sign',
        `-username=${process.env.ESIGNER_USERNAME}`,
        `-password=${process.env.ESIGNER_PASSWORD}`,
        `-credential_id=${process.env.ESIGNER_CREDENTIAL_ID}`,
        `-totp_secret=${process.env.ESIGNER_TOTP_SECRET}`,
        `-input_file_path=${exePath}`,
        `-output_dir_path=${outDir}`,
        '-override=true',
      ],
      { cwd: cstDir, stdio: 'inherit', shell: true }
    );

    if (result.status !== 0) {
      throw new Error(`[afterPack] CodeSignTool exited ${result.status} for ${path.basename(exePath)}`);
    }

    // Signed file should be <outDir>\<original-filename>
    const signedCopy = path.join(outDir, path.basename(exePath));
    if (!fs.existsSync(signedCopy)) {
      throw new Error(`[afterPack] Signed copy not found at ${signedCopy}`);
    }

    const signedSize = fs.statSync(signedCopy).size;
    if (signedSize <= originalSize) {
      throw new Error(
        `[afterPack] Signed copy (${signedSize} B) is not larger than original (${originalSize} B) – signing may have failed`
      );
    }

    // Copy the signed file back over the original in appOutDir
    fs.copyFileSync(signedCopy, exePath);
    console.log(`[afterPack] Signed OK: ${path.basename(exePath)}  (${(signedSize/1024/1024).toFixed(1)} MB)`);

  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
};
