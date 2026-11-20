"use strict";
const { makeHandler } = require("./app");
const { pollAll } = require("./calendar");
const { dynamo } = require("./store");

const store = dynamo(process.env.TABLE);
const { KMSClient, EncryptCommand, DecryptCommand } = require("@aws-sdk/client-kms");
const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");
const kmsClient = new KMSClient({}), ssm = new SSMClient({});
const kms = {
  async encrypt(plain, ctx) { const r = await kmsClient.send(new EncryptCommand({ KeyId: process.env.KMS_KEY, Plaintext: Buffer.from(plain), EncryptionContext: ctx })); return Buffer.from(r.CiphertextBlob).toString("base64"); },
  async decrypt(b64, ctx) { const r = await kmsClient.send(new DecryptCommand({ KeyId: process.env.KMS_KEY, CiphertextBlob: Buffer.from(b64, "base64"), EncryptionContext: ctx })); return Buffer.from(r.Plaintext).toString("utf8"); }
};
let cached;
async function secrets() {
  if (!cached) {
    const r = await ssm.send(new GetParametersCommand({ Names: ["/uc/google-client-id", "/uc/google-client-secret"], WithDecryption: true }));
    const v = Object.fromEntries(r.Parameters.map((p) => [p.Name, p.Value]));
    cached = { clientId: v["/uc/google-client-id"], clientSecret: v["/uc/google-client-secret"] };
  }
  return cached;
}
const deps = { store, kms, secrets, fetchFn: fetch, now: Date.now, appUrl: process.env.APP_URL };
const http = makeHandler(deps);

exports.handler = async (event) => {
  if (event && event.task === "poll") { return pollAll(deps); }
  return http(event);
};
