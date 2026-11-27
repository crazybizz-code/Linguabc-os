// Local QA only: a stand-in for api.telegram.org on 127.0.0.1:8081. The app
// talks to it only when TELEGRAM_API_BASE=http://127.0.0.1:8081 (the app
// refuses any non-localhost override). Records every call in memory;
// GET /calls returns them (method and chat_id only, no text).
import http from "node:http";
const USERNAME = process.env.FAKE_TG_USERNAME ?? "linguabc_qa_bot";
const calls = [];
http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/calls") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(calls)); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const m = /^\/bot[^/]+\/(\w+)$/.exec(req.url ?? "");
    const method = m?.[1] ?? "?";
    let chat = null; try { chat = JSON.parse(body || "{}").chat_id ?? null; } catch {}
    calls.push({ method, chat_id: chat });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(method === "getMe" ? { ok: true, result: { id: 1, is_bot: true, username: USERNAME } } : { ok: true, result: { message_id: calls.length } }));
  });
}).listen(8081, "127.0.0.1", () => console.log("fake telegram on :8081"));
