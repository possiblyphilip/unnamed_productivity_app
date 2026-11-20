"use strict";
// DynamoDB access. The SDK ships with the Lambda Node 22 runtime, so it is required lazily and
// tests can pass an in-memory store with the same shape instead.
function dynamo(table) {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, BatchWriteCommand, DeleteCommand, UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return {
    async get(pk, sk) { const r = await doc.send(new GetCommand({ TableName: table, Key: { pk, sk } })); return r.Item || null; },
    async put(item) { await doc.send(new PutCommand({ TableName: table, Item: item })); },
    async del(pk, sk) { await doc.send(new DeleteCommand({ TableName: table, Key: { pk, sk } })); },
    async putMany(items) {
      for (let i = 0; i < items.length; i += 25) {
        let req = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
        for (let attempt = 0; req.length && attempt < 5; attempt++) {
          const r = await doc.send(new BatchWriteCommand({ RequestItems: { [table]: req } }));
          req = (r.UnprocessedItems && r.UnprocessedItems[table]) || [];
          if (req.length) { await new Promise((res) => setTimeout(res, 50 * 2 ** attempt)); }
        }
        if (req.length) { throw new Error("batch write left items unprocessed"); }
      }
    },
    async bumpVersion(pk) {
      await doc.send(new UpdateCommand({ TableName: table, Key: { pk, sk: "PROFILE" }, UpdateExpression: "ADD profile_version :one", ExpressionAttributeValues: { ":one": 1 } }));
    },
    async scanCalendars() {
      const out = []; let key;
      do {
        const r = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key, FilterExpression: "sk = :s", ExpressionAttributeValues: { ":s": "CAL#google" } }));
        out.push(...r.Items); key = r.LastEvaluatedKey;
      } while (key);
      return out;
    },
    async query(pk, prefix) {
      const out = []; let key;
      do {
        const r = await doc.send(new QueryCommand({
          TableName: table, ExclusiveStartKey: key,
          KeyConditionExpression: prefix ? "pk = :p AND begins_with(sk, :s)" : "pk = :p",
          ExpressionAttributeValues: prefix ? { ":p": pk, ":s": prefix } : { ":p": pk }
        }));
        out.push(...r.Items); key = r.LastEvaluatedKey;
      } while (key);
      return out;
    }
  };
}
module.exports = { dynamo };
