import Scheduler from './scheduler.js';
import Runtime from './runtime.js';
import { enforceConstraints, recordConstraintUsage } from './constraint-engine.js';

/**
 * Validate and parse enhanced schedule format for scheduled_time access_type
 *
 * Enhanced formats support multiple specifications separated by semicolons:
 *
 * Basic formats:
 * - interval:5min - Every 5 minutes
 * - daily:09:00 - Daily at 9:00 AM
 * - cron:0 *_/5 * * * * - Standard cron format (replace _ with /)
 *
 * Enhanced formats with timing:
 * - interval:5min;start:2025-01-01T09:00:00Z - Every 5min starting at specific time
 * - daily:09:00;end:2025-12-31T23:59:59Z - Daily until end date
 * - interval:1hour;start:09:00;end:17:00 - Every hour between 9 AM and 5 PM daily
 * - interval:30min;duration:2hour - Every 30min for 2 hours from when scheduled
 *
 * Multiple schedules (comma-separated):
 * - "interval:5min;start:09:00,daily:18:00;duration:1hour" - Two separate schedules
 *
 * Default if not provided: "interval:5min"
 */
export const parseScheduleFormat = (schedule) => {
  if (!schedule || typeof schedule !== 'string') {
    return [{ type: 'interval', value: '5min' }];
  }

  // Split multiple schedules by comma
  const schedules = schedule.split(',').map(s => s.trim());
  const parsedSchedules = [];

  for (const sched of schedules) {
    const parts = sched.split(';').map(p => p.trim());
    const scheduleObj = {};

    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const key = part.substring(0, colonIdx).trim();
      const value = part.substring(colonIdx + 1).trim();
      if (!key || !value) continue;

      switch (key) {
        case 'interval':
        case 'daily':
        case 'cron':
          scheduleObj.type = key;
          scheduleObj.value = value;
          break;
        case 'start':
          // Can be ISO date, time (HH:MM), or relative (e.g., "now", "+1hour")
          scheduleObj.startTime = parseTimeValue(value);
          break;
        case 'end':
          // Can be ISO date, time (HH:MM), or relative
          scheduleObj.endTime = parseTimeValue(value);
          break;
        case 'duration':
          // Format: 1hour, 30min, 2day
          scheduleObj.duration = parseDurationValue(value);
          break;
      }
    }

    // Validate required fields
    if (scheduleObj.type && scheduleObj.value && isValidBasicSchedule(scheduleObj.type, scheduleObj.value)) {
      parsedSchedules.push(scheduleObj);
    }
  }

  return parsedSchedules.length > 0 ? parsedSchedules : [{ type: 'interval', value: '5min' }];
};

// Helper function to parse time values
export const parseTimeValue = (value) => {
  // ISO date format
  if (value.includes('T') || value.includes('-')) {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  // Time format (HH:MM)
  if (/^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(value)) {
    const [hours, minutes] = value.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    // If time has passed today, schedule for tomorrow
    if (date < new Date()) {
      date.setDate(date.getDate() + 1);
    }
    return date;
  }

  // Relative time (e.g., "now", "+1hour", "+30min")
  if (value === 'now') {
    return new Date();
  }

  if (value.startsWith('+')) {
    const match = value.slice(1).match(/^(\d+)(sec|min|hour|day)$/);
    if (match) {
      const [, amount, unit] = match;
      const ms = {
        sec: 1000,
        min: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000
      }[unit];
      return new Date(Date.now() + parseInt(amount) * ms);
    }
  }

  return null;
};

// Helper function to parse duration values
export const parseDurationValue = (value) => {
  const match = value.match(/^(\d+)(sec|min|hour|day)$/);
  if (match) {
    const [, amount, unit] = match;
    const ms = {
      sec: 1000,
      min: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000
    }[unit];
    return parseInt(amount) * ms;
  }
  return null;
};

// Helper function to validate basic schedule types
export const isValidBasicSchedule = (type, value) => {
  switch (type) {
    case 'interval':
      return /^\d+(sec|min|hour)$/.test(value);
    case 'daily':
      return /^([0-1]?\d|2[0-3]):([0-5]\d)$/.test(value);
    case 'cron':
      return value.split(' ').length === 6;
    default:
      return false;
  }
};

// Legacy function for backwards compatibility
export const isValidScheduleFormat = (schedule) => {
  const parsed = parseScheduleFormat(schedule);
  return parsed.length > 0 && parsed[0].type;
};

// Setup scheduled execution for scheduled_time access_type with enhanced scheduling
export const setupScheduledExecution = async ({ authCode, manifest, schedule, redirectUri, tokenManager, sessionKeyPairs, oauthCrypto, withSerializedLock, manifestExecutionLocks, getManifestExecutionKey, recordLog }) => {
  // Use static import
  const scheduler = new Scheduler();

  // Parse enhanced schedule format
  const parsedSchedules = parseScheduleFormat(schedule);
  const createdTasks = [];

  // Create tasks for each schedule specification
  for (let i = 0; i < parsedSchedules.length; i++) {
    const schedSpec = parsedSchedules[i];

    // Calculate period in minutes
    let periodInMinutes = 5; // default

    if (schedSpec.type === 'interval') {
      const match = schedSpec.value.match(/(\d+)(sec|min|hour)/);
      if (match) {
        const [, value, unit] = match;
        switch (unit) {
          case 'sec': periodInMinutes = Math.max(1, Math.ceil(parseInt(value) / 60)); break;
          case 'min': periodInMinutes = Math.max(1, parseInt(value)); break;
          case 'hour': periodInMinutes = parseInt(value) * 60; break;
        }
      }
    } else if (schedSpec.type === 'daily') {
      periodInMinutes = 24 * 60; // 24 hours
    }

    // Determine start and end times
    let startTime = schedSpec.startTime || null;
    let endTime = schedSpec.endTime || null;

    // Handle duration-based end time
    if (schedSpec.duration && !endTime) {
      const baseTime = startTime || new Date();
      endTime = new Date(baseTime.getTime() + schedSpec.duration);
    }

    // Create unique task name
    const taskName = `scheduled_${authCode}_${Date.now()}_${i}`;

    // Export signing key pair for durable storage (service worker may restart between scheduled runs)
    // SECURITY: Encrypt private key at rest using the ephemeral AES-GCM key
    let exportedKeyPair = null;
    const keyPair = sessionKeyPairs.get(authCode);
    if (keyPair) {
      try {
        const exportedPrivateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
        const encryptedPrivateKey = await tokenManager.encryptToken(exportedPrivateKey);
        exportedKeyPair = {
          privateKeyJWK_encrypted: encryptedPrivateKey,
          publicKeyJWK: keyPair.publicKeyJWK
        };
      } catch (e) {
        console.warn('Failed to export signing key pair for scheduled task:', e.message);
      }
    }

    // Capture the exported key pair in closure for the callback
    const taskKeyPair = exportedKeyPair;

    // Create scheduled task with enhanced timing
    await scheduler.createTask({
      name: taskName,
      periodInMinutes: periodInMinutes,
      startTime: startTime,
      endTime: endTime,
      callback: async () => {
        try {
          console.log(`Executing scheduled manifest for ${taskName}`);
          let runtimeOpts = null;
          let result = null;

          await withSerializedLock(
            manifestExecutionLocks,
            getManifestExecutionKey({ code: authCode, manifest }),
            async () => {
              const constraintCheck = await enforceConstraints({ code: authCode, manifest });
              if (!constraintCheck.allowed) {
                console.warn(`Scheduled task ${taskName} blocked: ${constraintCheck.reason}`);
                recordLog({ status: 'rejected', type: 'scheduled', manifest: taskName, initiator: 'scheduler', reason: constraintCheck.reason });
                return;
              }

              runtimeOpts = {
                constraints: constraintCheck.manifestEntry?.constraints || null
              };
              if (taskKeyPair?.privateKeyJWK_encrypted) {
                try {
                  const decryptedJWK = await tokenManager.decryptToken(taskKeyPair.privateKeyJWK_encrypted);
                  if (decryptedJWK) {
                    const privKey = await crypto.subtle.importKey(
                      'jwk', decryptedJWK,
                      { name: 'ECDSA', namedCurve: 'P-256' },
                      false, ['sign']
                    );
                    runtimeOpts = {
                      ...runtimeOpts,
                      privateKey: privKey,
                      publicKeyJWK: taskKeyPair.publicKeyJWK
                    };
                  }
                } catch (e) {
                  console.warn('Failed to import signing key for Runtime:', e.message);
                }
              }
              const runtime = new Runtime(runtimeOpts);
              result = await runtime.executeManifest(manifest);
              await recordConstraintUsage({ code: authCode, manifest });
            }
          );

          if (!result || !runtimeOpts) {
            return;
          }

          const scheduledPayload = {
            type: 'scheduled_data',
            data: result,
            timestamp: new Date().toISOString(),
            taskName: taskName,
            scheduleSpec: {
              type: schedSpec.type,
              value: schedSpec.value,
              startTime: schedSpec.startTime,
              endTime: schedSpec.endTime
            }
          };

          const scheduledBodyStr = JSON.stringify(scheduledPayload);

          // Sign a SHA-256 digest of the body
          let signatureJWT = '';
          if (taskKeyPair?.privateKeyJWK_encrypted) {
            try {
              const decryptedJWK = await tokenManager.decryptToken(taskKeyPair.privateKeyJWK_encrypted);
              if (decryptedJWK) {
                const privateKey = await crypto.subtle.importKey(
                  'jwk',
                  decryptedJWK,
                  { name: 'ECDSA', namedCurve: 'P-256' },
                  false,
                  ['sign']
                );
                const bodyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scheduledBodyStr));
                const bodyHashB64 = oauthCrypto.base64URLEncode(new Uint8Array(bodyHash));
                signatureJWT = await oauthCrypto.signJWT(
                  { alg: 'ES256', typ: 'oauthub+jwt' },
                  { body_hash: bodyHashB64, iat: Math.floor(Date.now() / 1000) },
                  privateKey
                );
              }
            } catch (signErr) {
              console.warn('Failed to sign scheduled payload:', signErr.message);
            }
          }

          // Send result to API endpoint
          await fetch(redirectUri, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authCode}`,
              'X-OAuthHub-Type': 'scheduled_data',
              'X-OAuthHub-Signature': signatureJWT
            },
            body: scheduledBodyStr
          }).catch(error => {
            console.error(`Failed to send scheduled data for ${taskName}:`, error);
          });

        } catch (error) {
          console.error(`Scheduled execution failed for ${taskName}:`, error);
        }
      }
    });

    console.log(`Created scheduled task: ${taskName} - Type: ${schedSpec.type}, Period: ${periodInMinutes}min`);
    createdTasks.push(taskName);

    // Store task reference for cleanup (with signing key pair for recovery)
    await storeScheduledTask({
      taskName,
      authCode,
      manifest,
      schedule: JSON.stringify(schedSpec),
      redirectUri,
      createdAt: new Date().toISOString(),
      scheduleIndex: i,
      signingKeyPair: exportedKeyPair
    });
  }

  return createdTasks;
};

// Store scheduled task information for management
export const storeScheduledTask = async (taskData) => {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("OAuthHubDB", 3);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const transaction = db.transaction(["scheduledTasks"], "readwrite");
    const store = transaction.objectStore("scheduledTasks");

    await new Promise((resolve, reject) => {
      const request = store.put(taskData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error('Failed to store scheduled task:', error);
  }
};
