import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import type { Subscription } from 'expo-modules-core';

const ExpoHttpServer = requireNativeModule('ExpoHttpServer');
const emitter = new EventEmitter(ExpoHttpServer);

export interface HttpRequest {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export function start(port: number, host: string): Promise<void> {
  return ExpoHttpServer.start(port, host);
}

export function stop(): Promise<void> {
  return ExpoHttpServer.stop();
}

export function startForegroundService(): Promise<void> {
  return ExpoHttpServer.startForegroundService();
}

export function stopForegroundService(): Promise<void> {
  return ExpoHttpServer.stopForegroundService();
}

export function respond(
  requestId: string,
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): void {
  ExpoHttpServer.respond(requestId, statusCode, headers, body);
}

export function addRequestListener(
  listener: (event: HttpRequest) => void,
): Subscription {
  return emitter.addListener('onRequest', listener);
}

export default ExpoHttpServer;
