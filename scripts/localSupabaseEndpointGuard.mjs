import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';

export const DEFAULT_LOCAL_SUPABASE_PORTS = Object.freeze([54321]);

const REQUIRED_ENV_NAMES = Object.freeze([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]);
const EXPECTED_PROJECT_ENV_NAME = 'DROP_LOCAL_SUPABASE_EXPECTED_PROJECT_ID';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOCAL_CONTAINER_OWNERS = new Set([
  'com.docker.backend',
  'com.docker.vpnkit',
  'docker-proxy',
  'dockerd',
  'docker',
  'com.rancherdesktop',
  'rancherdesktop',
  'rancher-desktop',
  'host.lima',
  'limactl',
  'gvproxy',
  'vpnkit',
  'orbstack',
  'orb',
  'podman',
  'rootlesskit',
  'rootlessport',
  'slirp4netns',
  'pasta',
  'conmon',
  'wslrelay',
  'wslhost',
]);
const TUNNEL_OWNERS = new Set([
  'ssh', 'sshd', 'autossh', 'sshuttle', 'plink', 'socat', 'stunnel', 'ngrok',
  'cloudflared', 'kubectl', 'telepresence', 'frpc', 'frps', 'chisel', 'tailscale',
  'zrok', 'inlets', 'boringproxy', 'nc', 'ncat', 'netcat',
]);
const OWNER_READ_ERROR = 'Could not verify local Supabase listener owners; the smoke was stopped.';
const PROJECT_ID_ERROR = 'Could not verify the expected local Supabase project; the smoke was stopped.';
const DOCKER_INSPECTION_ERROR = 'Could not verify the expected local Supabase container; the smoke was stopped.';

function normalizeProcessName(value) {
  const path = String(value || '').replaceAll('\\', '/');
  return basename(path).replace(/\.exe$/i, '').toLowerCase();
}

function assertOwnerRecords(owners) {
  if (!Array.isArray(owners)) throw new Error(OWNER_READ_ERROR);
  for (const owner of owners) {
    if (!owner || !/^\d+$/.test(String(owner.pid || '')) || !normalizeProcessName(owner.processName)) {
      throw new Error(OWNER_READ_ERROR);
    }
  }
}

export function parseLsofOwners(output) {
  if (typeof output !== 'string') throw new Error(OWNER_READ_ERROR);
  const owners = [];
  let current = null;

  const finishRecord = () => {
    if (current === null) return;
    if (!current.processName) throw new Error(OWNER_READ_ERROR);
    owners.push(current);
    current = null;
  };

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('p')) {
      finishRecord();
      const pid = line.slice(1);
      if (!/^\d+$/.test(pid)) throw new Error(OWNER_READ_ERROR);
      current = { pid, processName: '' };
    } else if (line.startsWith('c') && current && !current.processName) {
      current.processName = line.slice(1);
      if (!current.processName) throw new Error(OWNER_READ_ERROR);
    } else if (line.startsWith('f') && current?.processName && /^f[A-Za-z0-9_.-]+$/.test(line)) {
      // lsof emits file-descriptor rows even when the request asks only for PID and command fields.
      continue;
    } else {
      throw new Error(OWNER_READ_ERROR);
    }
  }
  finishRecord();

  const uniqueOwners = new Map();
  for (const owner of owners) uniqueOwners.set(`${owner.pid}:${owner.processName}`, owner);
  return [...uniqueOwners.values()];
}

export function parsePowerShellOwners(output) {
  if (typeof output !== 'string') throw new Error(OWNER_READ_ERROR);
  const owners = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf('|');
    if (separator < 1) throw new Error(OWNER_READ_ERROR);
    const pid = line.slice(0, separator).trim();
    const processName = line.slice(separator + 1).trim();
    if (!/^\d+$/.test(pid) || !processName) throw new Error(OWNER_READ_ERROR);
    owners.push({ pid, processName });
  }
  const uniqueOwners = new Map();
  for (const owner of owners) uniqueOwners.set(`${owner.pid}:${owner.processName}`, owner);
  return [...uniqueOwners.values()];
}

function runLsof(port) {
  const result = spawnSync('lsof', [
    '-nP', '+c', '0', '-Fpc', `-iTCP:${port}`, '-sTCP:LISTEN',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.signal || result.status === null) throw new Error(OWNER_READ_ERROR);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.status === 1 && !stdout.trim() && !stderr.trim()) return [];
  if (result.status !== 0 || stderr.trim() || !stdout.trim()) throw new Error(OWNER_READ_ERROR);
  return parseLsofOwners(stdout);
}

function runPowerShell(port) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$rows = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue)`,
    'foreach ($row in $rows) {',
    '  $owner = Get-Process -Id $row.OwningProcess -ErrorAction Stop',
    '  Write-Output ("{0}|{1}" -f $row.OwningProcess, $owner.ProcessName)',
    '}',
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.signal || result.status !== 0 || (result.stderr || '').trim()) {
    throw new Error(OWNER_READ_ERROR);
  }
  return parsePowerShellOwners(result.stdout || '');
}

export function inspectLocalSupabasePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(OWNER_READ_ERROR);
  return process.platform === 'win32' ? runPowerShell(port) : runLsof(port);
}

function validateProjectId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(value)) throw new Error(PROJECT_ID_ERROR);
  return value;
}

export function parseLocalSupabaseProjectId(source) {
  if (typeof source !== 'string') throw new Error(PROJECT_ID_ERROR);
  const matches = [...source.matchAll(/^[ \t]*project_id[ \t]*=[ \t]*"([^"]+)"[ \t]*(?:#.*)?$/gm)];
  if (matches.length !== 1) throw new Error(PROJECT_ID_ERROR);
  return validateProjectId(matches[0][1]);
}

export async function loadExpectedLocalSupabaseProjectId({
  environment = process.env,
  configFilePath,
  readConfigFile = readFile,
} = {}) {
  const override = typeof environment[EXPECTED_PROJECT_ENV_NAME] === 'string'
    ? environment[EXPECTED_PROJECT_ENV_NAME].trim()
    : '';
  if (override) return validateProjectId(override);
  try {
    if (!configFilePath) throw new Error();
    return parseLocalSupabaseProjectId(await readConfigFile(configFilePath, 'utf8'));
  } catch {
    throw new Error(PROJECT_ID_ERROR);
  }
}

function runDocker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 32 * 1024,
  });
  if (result.error || result.signal || result.status !== 0 || (result.stderr || '').trim()) {
    throw new Error(DOCKER_INSPECTION_ERROR);
  }
  return (result.stdout || '').trim();
}

function assertLocalDockerContext(run = runDocker, environment = process.env) {
  // DOCKER_HOST can silently redirect an otherwise local context to a remote daemon.
  if (environment.DOCKER_HOST?.trim()) throw new Error(DOCKER_INSPECTION_ERROR);
  const contextName = run(['context', 'show']);
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(contextName)) throw new Error(DOCKER_INSPECTION_ERROR);
  const endpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', contextName]);
  if (!endpoint.startsWith('unix:///') && !/^npipe:\/\//i.test(endpoint)) {
    throw new Error(DOCKER_INSPECTION_ERROR);
  }
}

export function parseLocalSupabaseKongInspection(output, { expectedProjectId, port }) {
  try {
    const projectId = validateProjectId(expectedProjectId);
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || typeof output !== 'string') return false;
    const fields = output.split('|');
    if (fields.length !== 4) return false;
    const [name, status, projectLabel, rawMappings] = fields;
    if (name !== `/supabase_kong_${projectId}` || status !== 'running' || projectLabel !== projectId) return false;
    const mappings = rawMappings.split(';').filter(Boolean).map((mapping) => {
      const parts = mapping.split(',');
      if (parts.length !== 2) throw new Error();
      return { hostIp: parts[0], hostPort: parts[1] };
    });
    return mappings.length > 0 && mappings.every(({ hostIp, hostPort }) => (
      LOOPBACK_HOSTS.has(hostIp.toLowerCase()) && hostPort === String(port)
    ));
  } catch {
    return false;
  }
}

export function inspectLocalSupabaseKong(expectedProjectId, port) {
  let projectId;
  try {
    projectId = validateProjectId(expectedProjectId);
    assertLocalDockerContext();
    const containerName = `supabase_kong_${projectId}`;
    const format = '{{.Name}}|{{.State.Status}}|{{index .Config.Labels "com.supabase.cli.project"}}|{{range (index .NetworkSettings.Ports "8000/tcp")}}{{.HostIp}},{{.HostPort}};{{end}}';
    const output = runDocker(['inspect', '--type', 'container', '--format', format, containerName]);
    return parseLocalSupabaseKongInspection(output, { expectedProjectId: projectId, port });
  } catch {
    throw new Error(DOCKER_INSPECTION_ERROR);
  }
}

export async function assertLocalSupabasePortsAreSafe({
  ports: requestedPorts,
  expectedProjectId,
  inspectPort = inspectLocalSupabasePort,
  inspectProjectContainer = inspectLocalSupabaseKong,
} = {}) {
  const ports = [...new Set(requestedPorts ?? DEFAULT_LOCAL_SUPABASE_PORTS)];
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(OWNER_READ_ERROR);
    let owners;
    try {
      owners = await inspectPort(port);
      assertOwnerRecords(owners);
    } catch {
      throw new Error(`Could not verify listener owners for local Supabase port ${port}; the smoke was stopped.`);
    }

    let matchesExpectedContainer = false;
    try {
      const projectId = validateProjectId(expectedProjectId);
      matchesExpectedContainer = await inspectProjectContainer(projectId, port);
    } catch {
      throw new Error(PROJECT_ID_ERROR);
    }
    if (!matchesExpectedContainer) {
      throw new Error(`Local Supabase port ${port} has no verified matching project container; the smoke was stopped.`);
    }

    for (const owner of owners) {
      const processName = normalizeProcessName(owner.processName);
      if (!TUNNEL_OWNERS.has(processName) && !LOCAL_CONTAINER_OWNERS.has(processName)) {
        throw new Error(`Local Supabase port ${port} has an unrecognized listener owner; the smoke was stopped.`);
      }
    }
  }
}

export function parseLocalSupabaseEnvFile(source) {
  const values = {};
  for (const rawLine of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
    values[name] = quoted ? (quoted[1] ?? quoted[2]) : rawValue.replace(/\s+#.*$/, '').trim();
  }
  return values;
}

export function resolveLocalSupabaseValues({ environment = {}, envFileContents = '' } = {}) {
  const fileValues = parseLocalSupabaseEnvFile(envFileContents);
  return Object.fromEntries(REQUIRED_ENV_NAMES.map((name) => {
    const override = typeof environment[name] === 'string' ? environment[name].trim() : '';
    return [name, override || fileValues[name] || ''];
  }));
}

export async function loadLocalSupabaseValues({ environment = process.env, envFilePath, readEnvFile = readFile } = {}) {
  let values = resolveLocalSupabaseValues({ environment });
  if (REQUIRED_ENV_NAMES.every((name) => values[name])) return values;

  let envFileContents;
  try {
    if (!envFilePath) throw new Error('Missing env path.');
    envFileContents = await readEnvFile(envFilePath, 'utf8');
  } catch {
    throw new Error('Provide the local Supabase URL, anon key, and service-role key through the environment or .env.local.');
  }
  values = resolveLocalSupabaseValues({ environment, envFileContents });
  if (REQUIRED_ENV_NAMES.some((name) => !values[name])) {
    throw new Error('Provide the local Supabase URL, anon key, and service-role key through the environment or .env.local.');
  }
  return values;
}

export function createBrowserSmokeEnvironment({
  environment = process.env,
  home,
  temporaryDirectory,
  platform = process.platform,
} = {}) {
  const browserEnv = {
    PATH: environment.PATH || '',
    HOME: home || environment.HOME || environment.USERPROFILE || tmpdir(),
    TMPDIR: temporaryDirectory || environment.TMPDIR || environment.TEMP || tmpdir(),
  };
  for (const name of ['LANG', 'LC_ALL', 'TZ']) if (environment[name]) browserEnv[name] = environment[name];
  if (platform === 'win32') {
    for (const name of ['SystemRoot', 'WINDIR', 'USERPROFILE', 'TEMP', 'TMP']) {
      if (environment[name]) browserEnv[name] = environment[name];
    }
  }
  return browserEnv;
}

export function createLocalSmokeAppEnvironment({
  environment = process.env,
  supabaseValues,
  temporaryDirectory,
  platform = process.platform,
} = {}) {
  if (!supabaseValues || REQUIRED_ENV_NAMES.some((name) => (
    typeof supabaseValues[name] !== 'string' || !supabaseValues[name].trim()
  ))) {
    throw new Error('Local smoke app environment is missing Supabase values.');
  }
  return {
    ...createBrowserSmokeEnvironment({ environment, temporaryDirectory, platform }),
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    WATCHPACK_POLLING: 'true',
    ...Object.fromEntries(REQUIRED_ENV_NAMES.map((name) => [name, supabaseValues[name]])),
  };
}

export function validateLocalSupabaseUrl(rawValue) {
  let url;
  try {
    if (typeof rawValue !== 'string' || !rawValue.trim()) throw new Error();
    url = new URL(rawValue);
  } catch {
    throw new Error('The configured Supabase URL must be a local HTTP origin.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(url.port);
  if (!LOOPBACK_HOSTS.has(hostname)
    || url.protocol !== 'http:'
    || !url.port
    || !Number.isInteger(port)
    || port < 1024
    || port > 65_535
    || url.username
    || url.password
    || url.search
    || url.hash
    || /[?#]/.test(rawValue)
    || url.pathname !== '/') {
    throw new Error('The configured Supabase URL must be a local HTTP origin.');
  }
  return url;
}
