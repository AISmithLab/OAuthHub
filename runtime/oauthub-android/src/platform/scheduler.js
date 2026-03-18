/**
 * Scheduler for Android — replaces chrome.alarms with expo-task-manager.
 * Same API surface as Chrome version.
 *
 * Tasks are persisted in SQLite so they survive app restarts.
 * expo-task-manager requires defineTask at module level, so we use a
 * single background task that dispatches to registered callbacks.
 */
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { storage } from './storage';

const BACKGROUND_TASK_NAME = 'oauthub-scheduler';

// Runtime callback registry (non-persistent — rehydrated on app start)
const taskCallbacks = new Map();

// Define the single background task at module level (expo requirement)
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  const now = Date.now();
  let didWork = false;

  for (const [name, callback] of taskCallbacks) {
    const meta = await storage.get('scheduledTasks', name);
    if (!meta) continue;

    if (meta.endTime && now > new Date(meta.endTime).getTime()) {
      taskCallbacks.delete(name);
      await storage.delete('scheduledTasks', name);
      continue;
    }
    if (meta.startTime && now < new Date(meta.startTime).getTime()) {
      continue;
    }

    try {
      await callback();
      didWork = true;
    } catch (error) {
      console.error(`Task ${name} failed:`, error);
    }
  }

  return didWork
    ? BackgroundFetch.BackgroundFetchResult.NewData
    : BackgroundFetch.BackgroundFetchResult.NoData;
});

class Scheduler {
  constructor() {
    this._registered = false;
  }

  async _ensureRegistered(periodInMinutes) {
    if (this._registered) return;
    try {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
        minimumInterval: Math.max(60, (periodInMinutes || 15) * 60),
        stopOnTerminate: false,
        startOnBoot: true,
      });
      this._registered = true;
    } catch (error) {
      console.warn('Failed to register background fetch:', error.message);
    }
  }

  async createTask({ name, periodInMinutes, startTime, endTime, callback }) {
    taskCallbacks.set(name, callback);

    // Persist task metadata in SQLite
    await storage.put('scheduledTasks', {
      taskName: name,
      periodInMinutes,
      startTime: startTime || null,
      endTime: endTime || null,
      createdAt: new Date().toISOString(),
    });

    await this._ensureRegistered(periodInMinutes);

    // Best-effort end-time cleanup
    if (endTime) {
      const delay = new Date(endTime).getTime() - Date.now();
      if (delay > 0) setTimeout(() => this.removeTask(name), delay);
    }

    return name;
  }

  async handleAlarm(alarm) {
    const name = alarm.name || alarm;
    const callback = taskCallbacks.get(name);
    if (!callback) return false;

    const meta = await storage.get('scheduledTasks', name);
    const now = Date.now();

    if (meta?.endTime && now > new Date(meta.endTime).getTime()) {
      await this.removeTask(name);
      return true;
    }
    if (meta?.startTime && now < new Date(meta.startTime).getTime()) {
      return true;
    }

    try {
      await callback();
    } catch (error) {
      console.error(`Error executing task ${name}:`, error);
    }
    return true;
  }

  async removeTask(name) {
    taskCallbacks.delete(name);
    await storage.delete('scheduledTasks', name);

    // Only unregister the background task if no tasks remain
    if (taskCallbacks.size === 0) {
      try {
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK_NAME);
        this._registered = false;
      } catch {}
    }
  }

  async getAllTasks() {
    const persisted = await storage.getAll('scheduledTasks');
    return persisted.map(t => ({
      name: t.taskName,
      periodInMinutes: t.periodInMinutes,
      startTime: t.startTime,
      endTime: t.endTime,
    }));
  }
}

export default Scheduler;
