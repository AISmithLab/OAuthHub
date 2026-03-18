import type { NextApiRequest } from "next";
import OAuthHubClient from "~/lib/oauthub-client";
import { db } from "~/server/db";

export const oauthHubApiConfig = { api: { bodyParser: false } };

export class OAuthHubRequestError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "OAuthHubRequestError";
    this.statusCode = statusCode;
  }
}

function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function getStoredPublicKey(): Promise<unknown> {
  try {
    return (await db.getData("/oauthub") as { publicKey?: unknown }).publicKey;
  } catch {
    throw new OAuthHubRequestError(401, "No OAuthHub session found");
  }
}

export async function verifyOAuthHubRequest<T>(req: NextApiRequest): Promise<{ body: T; rawBody: string }> {
  const rawBody = await readRawBody(req);
  const publicKeyJwk = await getStoredPublicKey();
  if (!publicKeyJwk) {
    throw new OAuthHubRequestError(401, "Missing OAuthHub public key");
  }

  try {
    const result = await OAuthHubClient.verifySignedPayload<T>({
      headers: req.headers,
      rawBody,
      publicKeyJwk,
    });
    return { body: result.body, rawBody };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Missing OAuthHub signature") {
        throw new OAuthHubRequestError(401, error.message);
      }
      if (error.message === "Invalid signature") {
        throw new OAuthHubRequestError(401, error.message);
      }
      if (error.message === "Invalid JSON payload") {
        throw new OAuthHubRequestError(400, error.message);
      }
    }
    throw error;
  }
}

export function isOAuthHubRequestError(error: unknown): error is OAuthHubRequestError {
  return error instanceof OAuthHubRequestError;
}
