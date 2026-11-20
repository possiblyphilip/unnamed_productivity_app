#!/usr/bin/env node
"use strict";
// Run from your machine with your AWS credentials (AWS_PROFILE=unconscious).
//   node server/admin.js add-user kyra
//   node server/admin.js add-device kyra-ab12
//   node server/admin.js revoke <token>
// Needs UC_API (the function URL) and, for setup links, UC_APP (where the app is hosted).
// The SDK is not installed locally: run `npm i --no-save @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` once in server/.
const crypto = require("crypto");
const { dynamo } = require("./store");
const { hash } = require("./app");

const store = dynamo(process.env.TABLE || "uc-data");
const [cmd, arg] = process.argv.slice(2);

function link(token) {
  const app = process.env.UC_APP || "<app url>";
  return app + "#setup=" + token + "&api=" + encodeURIComponent(process.env.UC_API || "<function url>");
}
async function device(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  await store.put({ pk: "DEVICE#" + hash(token), sk: "DEVICE", user, created: Date.now() });
  return token;
}
(async () => {
  if (cmd === "add-user" && arg) {
    const user = arg.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) + "-" + crypto.randomBytes(3).toString("hex");
    await store.put({ pk: "USER#" + user, sk: "PROFILE", name: arg, profile_version: 0, created: Date.now() });
    console.log("user id:", user, "\nsetup link:", link(await device(user)));
  } else if (cmd === "add-device" && arg) {
    if (!(await store.get("USER#" + arg, "PROFILE"))) { throw new Error("no such user id"); }
    console.log("setup link:", link(await device(arg)));
  } else if (cmd === "revoke" && arg) {
    await store.del("DEVICE#" + hash(arg), "DEVICE"); console.log("revoked");
  } else { console.error("usage: add-user <name> | add-device <user id> | revoke <token>"); process.exit(2); }
})().catch((e) => { console.error(e.message); process.exit(1); });
