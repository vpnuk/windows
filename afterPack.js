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
 * We use an explicit -output_dir_path (a per-call temp dir) so we are never
 * dependent on CodeSignTool's default output location.  After signing we copy
 * the signed file back over the original and verify the Authenticode signature
 * with PowerShell before allowing the build to continue.
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

  // Use an explicit temp output dir so the signed copy lands in a known place
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cst-out-'));

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

  // CodeSignTool writes <outDir>\<original-filename> – copy it back
  const signedCopy = path.join(outDir, path.basename(exePath));
  if (!fs.existsSync(signedCopy)) {
    throw new Error(`[afterPack] Signed copy not found at ${signedCopy} – signing may have failed`);
  }

  fs.copyFileSync(signedCopy, exePath);
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`[afterPack] Signed copy written back to ${exePath}`);

  // Verify the signature is now present using PowerShell
  const verify = spawnSync(
    'powershell',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      `$s = Get-AuthenticodeSignature '${exePath}'; Write-Host "sig_status=$($s.Status)"; if ($s.Status -ne 'Valid') { exit 1 }`,
    ],
    { stdio: 'pipe', shell: false }
  );

  const verifyOut = (verify.stdout || Buffer.alloc(0)).toString().trim();
  console.log(`[afterPack] Signature check: ${verifyOut}`);

  if (verify.status !== 0) {
    const verifyErr = (verify.stderr || Buffer.alloc(0)).toString().trim();
    throw new Error(`[afterPack] Authenticode verification FAILED for ${path.basename(exePath)}: ${verifyErr || verifyOut}`);
  }

  console.log(`[afterPack] Signed OK: ${path.basename(exePath)}`);
};
