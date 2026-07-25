import { createServer } from "node:http";
import { createRelayerHttpServer } from "../src/http.ts";
import { MemoryGossipTransport } from "../src/gossip.ts";
import { RelayerHub } from "../src/hub.ts";
import { loadRelayerHubEnv } from "../src/env.ts";

// Validate env before the HTTP server/gossip hub is constructed.
const env = loadRelayerHubEnv();

const endpoint = env.gatewayEndpoint;
const endpointPort = new URL(endpoint).port;
const port = env.port ?? Number(endpointPort || 8787);

const transport = new MemoryGossipTransport();
const hub = new RelayerHub(transport);
await hub.start();

const server: ReturnType<typeof createServer> = createRelayerHttpServer(hub);
server.listen(port, () => {
  console.log(`Opaque relayer hub listening on ${endpoint}`);
});
