const REQUIRED_NODE = "24.19.0";
const REQUIRED_NPM = "11.17.0";
const REQUIRED_REGISTRY = "https://registry.npmjs.org/";

const npmUserAgent = process.env.npm_config_user_agent ?? "";
const npmVersion = /^npm\/([^\s]+)/u.exec(npmUserAgent)?.[1] ?? null;
const failures = [];
const registryOverride = Object.entries(process.env).find(
  ([key]) => key.toLowerCase() === "npm_config_registry",
)?.[1];

if (process.versions.node !== REQUIRED_NODE) {
  failures.push(`Node.js must be ${REQUIRED_NODE}; observed ${process.versions.node}`);
}

if (npmVersion !== REQUIRED_NPM) {
  failures.push(
    npmVersion === null
      ? `npm must run this check and report version ${REQUIRED_NPM}`
      : `npm must be ${REQUIRED_NPM}; observed ${npmVersion}`,
  );
}

if (registryOverride !== undefined && registryOverride !== REQUIRED_REGISTRY) {
  failures.push("npm registry override is not approved");
}

if (failures.length > 0) {
  process.stderr.write(`toolchain-version-mismatch\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`toolchain-ok node=${REQUIRED_NODE} npm=${REQUIRED_NPM}\n`);
}
