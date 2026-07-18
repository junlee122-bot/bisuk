function envPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

const host = "127.0.0.1";
const webPort = envPort("E2E_WEB_PORT", 3100);
const apiPort = envPort("E2E_API_PORT", 4100);

module.exports = {
  WEB: `http://${host}:${webPort}`,
  API: `http://${host}:${apiPort}`,
};
