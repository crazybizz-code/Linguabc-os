// Prints local-only HS256 keys (anon, service_role) for the local stack.
import { createHmac } from "node:crypto";
const secret = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (role) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role, iss: "supabase-local", iat: 1700000000, exp: 2000000000 });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`; };
console.log(`ANON=${sign("anon")}\nSERVICE=${sign("service_role")}`);
