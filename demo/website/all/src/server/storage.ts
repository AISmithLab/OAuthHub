import { db } from "~/server/db";
import { type VersionId } from "~/lib/demo-config";

function rootPath(version: VersionId): string {
  const versionKey = String(version);
  return `/versions/${versionKey}`;
}

export function googleTokensPath(version: VersionId): string {
  return `${rootPath(version)}/google/tokens`;
}

export function googleDataPath(version: VersionId): string {
  return `${rootPath(version)}/google/data`;
}

export function oauthHubAuthPath(version: VersionId): string {
  return `${rootPath(version)}/oauthub/auth`;
}

export function oauthHubDataPath(version: VersionId): string {
  return `${rootPath(version)}/oauthub/data`;
}

export function oauthHubTokenPath(version: VersionId): string {
  return `${rootPath(version)}/oauthub/tokens`;
}

export async function clearVersionState(version: VersionId): Promise<void> {
  const paths = [
    googleTokensPath(version),
    googleDataPath(version),
    oauthHubAuthPath(version),
    oauthHubDataPath(version),
    oauthHubTokenPath(version),
    rootPath(version),
  ];

  for (const path of paths) {
    try {
      await db.delete(path);
    } catch {
      // Ignore missing paths.
    }
  }
}
