import { MongoClient, type Db } from "mongodb";
import { MONGODB_URI } from "../config/env.js";

let clientPromise: Promise<MongoClient> | null = null;

export async function getMongoClient(uri = MONGODB_URI): Promise<MongoClient> {
  if (!uri) {
    throw new Error("MONGODB_URI is required for Mongo-backed storage.");
  }

  if (!clientPromise) {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }

  return clientPromise;
}

export async function getMongoDb(dbName?: string): Promise<Db> {
  const client = await getMongoClient();
  return client.db(dbName);
}
