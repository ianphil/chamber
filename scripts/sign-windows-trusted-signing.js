/* eslint-disable no-console */
const { spawnSync } = require('node:child_process');

let trustedSigningModuleReady = false;

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable for Windows signing: ${name}`);
  }
  return value;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script, label) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status}:\n${result.stdout}${result.stderr}`.trim()
    );
  }
}

function ensureTrustedSigningModule() {
  if (trustedSigningModuleReady) {
    return;
  }

  runPowerShell(
    [
      '$ErrorActionPreference = "Stop"',
      'try { Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction Stop | Out-Null } catch { Write-Verbose $_ }',
      'Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force -Repository PSGallery -Scope CurrentUser -ErrorAction Stop | Out-Null',
    ].join('; '),
    'TrustedSigning module setup'
  );
  trustedSigningModuleReady = true;
}

exports.sign = async function sign(configuration) {
  if (process.platform !== 'win32') {
    throw new Error('Azure Trusted Signing must run on Windows.');
  }

  const filePath = configuration.path;
  const endpoint = requireEnv('AZURE_TRUSTED_SIGNING_ENDPOINT');
  const accountName = requireEnv('AZURE_TRUSTED_SIGNING_ACCOUNT_NAME');
  const certificateProfileName = requireEnv('AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME');

  ensureTrustedSigningModule();

  console.log(`Signing ${filePath} with Azure Trusted Signing`);
  runPowerShell(
    [
      '$ErrorActionPreference = "Stop";',
      'Invoke-TrustedSigning',
      `-Endpoint ${psQuote(endpoint)}`,
      `-CodeSigningAccountName ${psQuote(accountName)}`,
      `-CertificateProfileName ${psQuote(certificateProfileName)}`,
      '-FileDigest SHA256',
      '-TimestampRfc3161 http://timestamp.acs.microsoft.com',
      '-TimestampDigest SHA256',
      `-Files ${psQuote(filePath)}`,
    ].join(' '),
    `Signing ${filePath}`
  );
};
