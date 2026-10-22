// Collects teardown callbacks (listeners, subscriptions, timers) and runs them once, newest first.
export function createCleanup() {
  const tasks = [];

  return {
    add(fn) {
      if (typeof fn === 'function') tasks.push(fn);
    },
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      tasks.push(() => target.removeEventListener(type, handler, options));
    },
    run() {
      while (tasks.length) {
        try {
          tasks.pop()();
        } catch (error) {
          console.error('Cleanup failed', error);
        }
      }
    },
  };
}
