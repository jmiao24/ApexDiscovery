import assert from "node:assert/strict";
import test from "node:test";
import { AllowlistedNetworkBroker, domainAllowed, publicNetworkAddress } from "./network-broker.mjs";

test("matches exact and scoped wildcard network domains", () => {
  assert.equal(domainAllowed("eutils.ncbi.nlm.nih.gov", ["eutils.ncbi.nlm.nih.gov"]), true);
  assert.equal(domainAllowed("api.gxl.ai", ["*.gxl.ai"]), true);
  assert.equal(domainAllowed("gxl.ai", ["*.gxl.ai"]), false);
  assert.equal(domainAllowed("gxl.ai", ["**.gxl.ai"]), true);
  assert.equal(domainAllowed("evilgxl.ai", ["**.gxl.ai"]), false);
  assert.equal(domainAllowed("127.0.0.1", ["**.gxl.ai"]), false);
});

test("allows only public resolved addresses", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.1.1", "172.16.0.1", "192.168.1.1", "192.0.2.1", "::1", "fc00::1", "2001:db8::1"]) {
    assert.equal(publicNetworkAddress(address), false, address);
  }
  assert.equal(publicNetworkAddress("8.8.8.8"), true);
  assert.equal(publicNetworkAddress("2606:4700:4700::1111"), true);
});

test("gives concurrent runtimes distinct private broker sockets", () => {
  const options = {
    workspaceRoot: "/tmp/workspace",
    sessionId: "shared-session",
    allowedDomains: ["eutils.ncbi.nlm.nih.gov"],
  };
  const first = new AllowlistedNetworkBroker(options);
  const second = new AllowlistedNetworkBroker(options);
  assert.notEqual(first.socketPath, second.socketPath);
});
