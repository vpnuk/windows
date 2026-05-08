'use strict';
const { execFileSync } = require('child_process');

/**
 * Custom eSigner (ssl.com) code-signing hook for electron-builder.
 *
 * Called by electron-builder AFTER rcedit re-stamps the exe (so the
 * Authenticode signature survives into the final installer).
 *
 * Required env vars (set in CI via GitHub secrets):
 *   CST_BAT              — absolute path to CodeSignTool.bat
 *   CST_DIR              — working directory for CodeSignTool
 *   ESIGNER_USERNAME     — ssl.com account username
 *   ESIGNER_PASSWORD     — ssl.com account password
 *   ESIGNER_CREDENTIAL_ID — ssl.com credential ID
 *   ESIGNER_TOTP_SECRET  — TOTP secret for the credential
 *
 * If CST_BAT / CST_DIR are absent (local dev), signing is skipped silently.
 */
module.exports = async function sign(configuration) {
  const cstBat = process.env.CST_BAT;
  const cstDir = process.env.CST_DIR;

  if (!cstBat || !cstDir) {
    console.log(`[sign.js] CST_BAT/CST_DIR not set — skipping signing for: ${configuration.path}`);
    return;
  }

  const filePath = configuration.path;
  console.log(`[sign.js] Signing: ${filePath}`);

  const args = [
    'sign',
    `-username=${process.env.ESIGNER_USERNAME}`,
    `-password=${process.env.ESIGNER_PASSWORD}`,
    `-credential_id=${process.env.ESIGNER_CREDENTIAL_ID}`,
    `-totp_secret=${process.env.ESIGNER_TOTP_SECRET}`,
    `-input_file_path=${filePath}`,
    '-override=true',
  ];

  execFileSync(cstBat, args, { cwd: cstDir, stdio: 'inherit' });
  console.log(`[sign.js] Signed OK: ${filePath}`);
};
