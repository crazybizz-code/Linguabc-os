// Local QA gateway (stands in for Supabase's Kong): /auth/v1 -> GoTrue,
// /rest/v1 -> PostgREST. Local synthetic data only.
import http from "node:http";
const routes = [["/auth/v1", 9999], ["/rest/v1", 3000]];
http.createServer((req, res) => {
  const cors = { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const hit = routes.find(([p]) => req.url.startsWith(p + "/") || req.url === p);
  if (!hit) { res.writeHead(404, cors); return res.end(); }
  const up = http.request({ host: "127.0.0.1", port: hit[1], path: req.url.slice(hit[0].length) || "/", method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502, cors); res.end(); });
  req.pipe(up);
}).listen(54321, "127.0.0.1", () => console.log("gateway on :54321"));
