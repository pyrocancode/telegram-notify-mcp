import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../src/server.js";

function jsonRpcError(status, message) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function checkAuth(request) {
  const secret = process.env.MCP_SECRET;
  if (!secret) return { ok: false, status: 503, message: "MCP_SECRET is not configured" };
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}

async function handleMcp(request) {
  const auth = checkAuth(request);
  if (!auth.ok) {
    return jsonRpcError(auth.status, auth.message);
  }

  if (request.method !== "POST") {
    return jsonRpcError(405, "Method not allowed.");
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("MCP error:", error);
    return jsonRpcError(500, "Internal server error");
  } finally {
    transport.close();
    server.close();
  }
}

// ponytail: Vercel may pass Web Request or Node (req, res) — handle both
export default async function handler(req, res) {
  try {
    if (req instanceof Request) {
      return handleMcp(req);
    }

    const host = req.headers.host ?? "localhost";
    const url = `https://${host}${req.url ?? "/api/mcp"}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body ?? {})
          : undefined,
    });
    const response = await handleMcp(request);

    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Handler error:", error);
    if (res?.status) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    return new Response("Internal server error", { status: 500 });
  }
}
