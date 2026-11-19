// Helpers for whoever writes keyrings and releases: tools, tests and the CLI. Devices don't need them.
import { seal } from "./envelope.js";
import { KEYRING, RELEASE } from "./keyring.js";

// groups: { root: [{ keys: [key...], threshold }], release: [...] }. Each key is a full key from
// generateKey; only its public part goes into the keyring.
export function keyringDoc({ keyring, app, roles, spare, requires, extra = {} }) {
  const keys = {};
  const outRoles = {};
  for (const [role, groups] of Object.entries(roles)) {
    outRoles[role] = groups.map((g) => {
      for (const k of g.keys) keys[k.kid] = { suite: k.suite, pub: k.pub };
      return { suite: g.suite ?? g.keys[0].suite, keys: g.keys.map((k) => k.kid), threshold: g.threshold ?? 1 };
    });
  }
  return { keyring, app, keys, roles: outRoles, spare: { suite: spare.suite, kid: spare.kid }, ...(requires ? { requires } : {}), ...extra };
}

export const sealKeyring = (doc, signers) => seal(KEYRING, doc, signers);
export const sealRelease = (doc, signers) => seal(RELEASE, doc, signers);
export const reveal = (key) => ({ ...key, reveal: true });
