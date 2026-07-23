import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmodSync, rmSync } from "node:fs";
import { isIP, createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeNetworkDomains } from "./codex-sandbox.mjs";

const MAX_HANDSHAKE_BYTES = 4_096;
const ALLOWED_PORTS = new Set([80, 443]);

export function networkBrokerSocketPath(workspaceRoot, sessionId) {
  const id = createHash("sha256").update(`${workspaceRoot}\0${sessionId}`).digest("hex").slice(0, 20);
  return join(tmpdir(), `apex-network-${id}.sock`);
}

export function domainAllowed(host, patterns) {
  const normalized = String(host ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || isIP(normalized)) return false;
  return patterns.some((pattern) => {
    if (pattern.startsWith("**.")) {
      const suffix = pattern.slice(3);
      return normalized === suffix || normalized.endsWith(`.${suffix}`);
    }
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return normalized !== suffix && normalized.endsWith(`.${suffix}`);
    }
    return normalized === pattern;
  });
}

export function publicNetworkAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const first = Number.parseInt(address.split(":", 1)[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !address.toLowerCase().startsWith("2001:db8:");
  }
  return false;
}

function reject(client, message) {
  if (!client.destroyed) client.end(`${JSON.stringify({ ok: false, error: message })}\n`);
}

/**
 * Raw TCP tunnel behind a private Unix socket. The Python kernel has no direct
 * network access; it sends `{host, port}` here, and the broker validates the
 * domain plus its resolved public IP before relaying end-to-end TLS bytes.
 */
export class AllowlistedNetworkBroker {
  constructor({ workspaceRoot, sessionId, allowedDomains }) {
    this.allowedDomains = normalizeNetworkDomains(allowedDomains);
    // Background ExecuteCode workers can share a session id, so every broker
    // needs its own socket rather than unlinking another worker's endpoint.
    this.socketPath = networkBrokerSocketPath(
      workspaceRoot,
      `${sessionId}-${process.pid}-${randomUUID()}`,
    );
    this.server = null;
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    rmSync(this.socketPath, { force: true });
    this.server = createServer((client) => this.#accept(client));
    this.ready = new Promise((resolve, rejectReady) => {
      this.server.once("error", rejectReady);
      this.server.listen(this.socketPath, () => {
        chmodSync(this.socketPath, 0o600);
        resolve(this.socketPath);
      });
    });
    return this.ready;
  }

  async #connect(client, request, remainder) {
    const host = String(request?.host ?? "").trim().toLowerCase().replace(/\.$/, "");
    const port = Number(request?.port);
    if (!domainAllowed(host, this.allowedDomains)) return reject(client, "domain is not allowlisted");
    if (!Number.isInteger(port) || !ALLOWED_PORTS.has(port)) return reject(client, "port is not allowed");

    let addresses;
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      return reject(client, "domain resolution failed");
    }
    const target = addresses.find((entry) => publicNetworkAddress(entry.address));
    if (!target) return reject(client, "domain did not resolve to a public address");

    const upstream = createConnection({ host: target.address, family: target.family, port });
    upstream.once("error", () => reject(client, "upstream connection failed"));
    upstream.once("connect", () => {
      client.write(`${JSON.stringify({ ok: true })}\n`);
      if (remainder.length) upstream.write(remainder);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  }

  #accept(client) {
    client.pause();
    let buffered = Buffer.alloc(0);
    const handshake = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_HANDSHAKE_BYTES) {
        client.off("data", handshake);
        reject(client, "broker handshake is too large");
        return;
      }
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) return;
      client.off("data", handshake);
      client.pause();
      let request;
      try {
        request = JSON.parse(buffered.subarray(0, newline).toString("utf8"));
      } catch {
        reject(client, "invalid broker handshake");
        return;
      }
      void this.#connect(client, request, buffered.subarray(newline + 1));
    };
    client.on("data", handshake);
    client.resume();
  }

  close() {
    this.server?.close();
    this.server = null;
    this.ready = null;
    rmSync(this.socketPath, { force: true });
  }
}
