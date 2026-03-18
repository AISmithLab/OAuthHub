/**
 * Scheduler for background task execution using Chrome Alarms API.
 *
 * Callbacks are closures that cannot be persisted, so this class also
 * stores serialisable task metadata (manifest, redirectUri, authCode,
 * signingKeyJWK) in IndexedDB.  When the MV3 service worker wakes up
 * for an alarm, the top-level alarm listener in index.js re-creates
 * the Runtime and executes the stored manifest directly.
 *
 * The in-memory `tasks` Map is only a convenience cache for the
 * current service-worker lifetime.  It is **not** the source of truth.
 */
class Scheduler {
  constructor() {
    // In-memory cache — lost when the service worker shuts down
    this.tasks = new Map();
  }

  // ─── Create a new scheduled task ──────────────────────────────
  async createTask({ name, periodInMinutes, startTime, endTime, callback }) {
    // Keep callback in memory for as long as the worker stays alive
    this.tasks.set(name, { callback, startTime, endTime });

    // Create Chrome alarm (survives worker restarts)
    await chrome.alarms.create(name, {
      periodInMinutes: Math.max(1, periodInMinutes),
      when: startTime ? new Date(startTime).getTime() : Date.now()
    });

    // Best-effort end-time cleanup while the worker is alive
    if (endTime) {
      const delay = new Date(endTime).getTime() - Date.now();
      if (delay > 0) {
        setTimeout(() => this.removeTask(name), delay);
      }
    }

    return name;
  }

  // ─── Handle an alarm fired by Chrome ──────────────────────────
  async handleAlarm(alarm) {
    const task = this.tasks.get(alarm.name);
    if (!task) return false; // Caller should fall back to IndexedDB

    const now = Date.now();
    if (task.endTime && now > new Date(task.endTime).getTime()) {
      await this.removeTask(alarm.name);
      return true;
    }
    if (task.startTime && now < new Date(task.startTime).getTime()) {
      return true; // Not yet time
    }

    try {
      await task.callback();
    } catch (error) {
      console.error(`Error executing task ${alarm.name}:`, error);
    }
    return true;
  }

  // ─── Remove a task ────────────────────────────────────────────
  async removeTask(name) {
    await chrome.alarms.clear(name);
    this.tasks.delete(name);
  }

  // ─── List active tasks ────────────────────────────────────────
  async getAllTasks() {
    const alarms = await chrome.alarms.getAll();
    return alarms.map(alarm => ({
      name: alarm.name,
      scheduledTime: new Date(alarm.scheduledTime),
      periodInMinutes: alarm.periodInMinutes,
      ...this.tasks.get(alarm.name)
    }));
  }
}

export default Scheduler;
