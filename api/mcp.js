import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../src/server.js";

function jsonRpcError(res, status, message) {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

function checkAuth(req) {
  const secret = process.env.MCP_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return jsonRpcError(
      res,
      process.env.MCP_SECRET ? 401 : 503,
      process.env.MCP_SECRET ? "Unauthorized" : "MCP_SECRET is not configured"
    );
  }

  if (req.method !== "POST") {
    return jsonRpcError(res, 405, "Method not allowed.");
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}
