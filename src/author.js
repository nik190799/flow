// Helpers for whoever writes keyrings and releases: tools, tests and the CLI. Devices don't need them.
import { seal } from "./envelope.js";
import { KEYRING, RELEASE } from "./keyring.js";
import { FUNCTION, GRANT } from "./functions.js";

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

// A person (or an agent holding a grant) signs a function for a direction the app opened.
//   doc { app, direction, id, seq, layer, reads?, caps?, intent? }
export async function sealFunction(doc, signer, grant = null) {
  const env = await seal(FUNCTION, doc, [signer]);
  return grant ? { ...env, grant } : env;
}
// A person passes part of their authority to an agent's key until notAfter.
export const sealGrant = ({ app, agent, directions, notAfter, caps }, person) =>
  seal(GRANT, { app, agent: { suite: agent.suite, pub: agent.pub }, directions, notAfter, ...(caps ? { caps } : {}) }, [person]);
