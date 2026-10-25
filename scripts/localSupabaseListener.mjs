import { execFileSync } from 'node:child_process';

const LOCAL_RUNTIME_COMMANDS = new Set([
  'colima',
  'com.docker.backend',
  'com.orbstack.orbstack',
  'com.rancherdesktop',
  'docker-proxy',
  'dockerd',
  'gvproxy',
  'lima',
  'podman',
  'podman-mac-helper',
  'podman-proxy',
  'rancher-desktop',
  'rootlesskit',
  'slirp4netns',
  'vpnkit',
  'vpnkit-bridge',
  'orbstack',
]);

const SUPABASE_SERVICE_PREFIX_BY_PORT = new Map([
  [54321, 'supabase_kong_'],
  [54324, 'supabase_inbucket_'],
]);

export function parseLsofListeners(output) {
  const listeners = [];
  let current = null;

  for (const field of String(output).split(/\r?\n/)) {
    if (field.startsWith('p')) {
      if (current?.command) listeners.push(current);
      current = { pid: field.slice(1), command: '' };
    } else if (field.startsWith('c') && current) {
      current.command = field.slice(1);
    }
  }

  if (current?.command) listeners.push(current);
  return listeners;
}

function inspectLsofListeners(port) {
  try {
    const output = execFileSync('lsof', [
      '-nP',
      '-Fpc',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseLsofListeners(output);
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    throw new Error(`Could not inspect local Supabase port ${port} (${code}); refusing to create test fixtures.`);
  }
}

function inspectProcessCommand(pid) {
  return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function isRancherLimaSshForwarder(pid, inspectCommand) {
  try {
    const command = inspectCommand(pid);
    // macOS reports Rancher Desktop's Lima control master as this exact process
    // title. Matching arbitrary argv substrings would also trust remote `ssh -L`
    // commands that happen to carry the same words in unrelated options.
    return /^ssh: .+\/rancher-desktop\/lima\/\d+\/ssh\.sock \[mux\]$/i.test(command);
  } catch {
    return false;
  }
}

function inspectDockerContextEndpoint(contextName) {
  const output = execFileSync('docker', [
    'context',
    'inspect',
    '--format',
    '{{json .Endpoints.docker.Host}}',
    contextName,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return JSON.parse(output);
}

export function inspectActiveDockerEndpoint({
  dockerContext = process.env.DOCKER_CONTEXT,
  dockerHost = process.env.DOCKER_HOST,
  currentContext = () => execFileSync('docker', ['context', 'show'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim(),
  inspectContext = inspectDockerContextEndpoint,
} = {}) {
  const contextName = dockerContext || currentContext();
  const contextEndpoint = inspectContext(contextName);

  // Docker and Supabase CLI versions differ in how they choose a daemon. If both
  // selectors are present, they must identify the same endpoint before tests write.
  if (dockerHost && contextEndpoint !== dockerHost) {
    throw new Error('Docker context and DOCKER_HOST select different endpoints.');
  }

  return dockerHost || contextEndpoint;
}

function isLocalDockerEndpoint(endpoint) {
  return typeof endpoint === 'string'
    && (endpoint.startsWith('unix:///') || endpoint.startsWith('npipe://'));
}

function inspectSupabaseContainers(port) {
  try {
    const output = execFileSync('docker', [
      'ps',
      '--filter',
      `publish=${port}`,
      '--format',
      '{{.Names}}',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  } catch {
    throw new Error(`Could not inspect local containers published on Supabase port ${port}.`);
  }
}

export function assertTrustedLocalSupabaseListener(port, {
  inspect = inspectLsofListeners,
  inspectCommand = inspectProcessCommand,
  dockerEndpoint,
  inspectDockerEndpoint = inspectActiveDockerEndpoint,
  inspectContainers = inspectSupabaseContainers,
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('A valid Supabase listener port is required before creating test fixtures.');
  }

  let listeners;
  try {
    listeners = inspect(port);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Could not inspect local Supabase port')) throw error;
    throw new Error(`Could not inspect local Supabase port ${port}; refusing to create test fixtures.`);
  }

  if (!Array.isArray(listeners) || listeners.length === 0) {
    throw new Error(`Could not verify a listener on local Supabase port ${port}; refusing to create test fixtures.`);
  }

  const untrustedOwner = listeners.find(({ pid, command }) => {
    const normalizedCommand = String(command).trim().toLowerCase();
    if (LOCAL_RUNTIME_COMMANDS.has(normalizedCommand)) return false;
    return normalizedCommand !== 'ssh' || !isRancherLimaSshForwarder(pid, inspectCommand);
  });
  if (untrustedOwner) {
    throw new Error(`Cannot verify local Supabase port ${port}: listener owner ${untrustedOwner.command} (PID ${untrustedOwner.pid}) is not a trusted local container runtime or Rancher Desktop forwarder. Refusing to create test fixtures.`);
  }

  let activeDockerEndpoint;
  try {
    activeDockerEndpoint = dockerEndpoint ?? inspectDockerEndpoint();
  } catch {
    throw new Error(`Could not verify the Docker context for local Supabase port ${port}; refusing to create test fixtures.`);
  }
  if (!isLocalDockerEndpoint(activeDockerEndpoint)) {
    throw new Error(`Cannot verify a local Docker context for Supabase port ${port}; refusing to create test fixtures.`);
  }

  const expectedServicePrefix = SUPABASE_SERVICE_PREFIX_BY_PORT.get(port);
  if (!expectedServicePrefix) {
    throw new Error(`No local Supabase service is defined for port ${port}; refusing to create test fixtures.`);
  }

  let containers;
  try {
    containers = inspectContainers(port);
  } catch {
    throw new Error(`Could not verify a local Supabase container on port ${port}; refusing to create test fixtures.`);
  }
  if (!Array.isArray(containers) || !containers.some((name) => String(name).startsWith(expectedServicePrefix))) {
    throw new Error(`Could not verify the expected local Supabase service on port ${port}; refusing to create test fixtures.`);
  }
}
