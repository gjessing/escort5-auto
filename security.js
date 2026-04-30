import { spawnSync } from 'child_process';

export function assertRequiredEnv(names) {
  const missing = names.filter((name) => !process.env[name] || !String(process.env[name]).trim());
  if (missing.length > 0) {
    throw new Error('Manglende miljoevariabler: ' + missing.join(', '));
  }
}

export function parsePositiveInt(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Ugyldig vaerdi for ' + fieldName + ': ' + value);
  }
  return parsed;
}

export function parsePercent(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 25) {
    throw new Error('Ugyldig vaerdi for ' + fieldName + ': ' + value + ' (skal vaere 0-25)');
  }
  return parsed;
}

export function sanitizeLabel(value, fieldName, maxLen = 80) {
  const text = String(value || '').trim();
  if (!text) throw new Error(fieldName + ' er paakraevet');
  if (text.length > maxLen) throw new Error(fieldName + ' er for lang (max ' + maxLen + ' tegn)');
  return text;
}

export function validateHttpUrl(value, fieldName) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('Ugyldig URL for ' + fieldName);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Kun http/https URL er tilladt for ' + fieldName);
  }
  return parsed.toString();
}

export function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error('Kommando fejlede med exit kode ' + result.status + ': ' + script);
  }
}
