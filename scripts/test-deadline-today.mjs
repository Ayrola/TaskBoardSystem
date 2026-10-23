import assert from 'node:assert/strict';
import { todayDeadlineInput } from '../src/utils/deadlines.js';
const originalTimezone = process.env.TZ;
try {
  for (const timezone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Sofia']) {
    process.env.TZ = timezone;
    for (const instant of ['2026-10-23T00:30:00Z', '2026-10-23T23:30:00Z']) {
      const now = new Date(instant);
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      assert.equal(todayDeadlineInput('', 'datetime-local', now), `${date}T17:00`);
      assert.equal(todayDeadlineInput('2020-01-01T09:45', 'datetime-local', now), `${date}T09:45`);
      assert.equal(todayDeadlineInput('', 'date', now), date);
    }
  }
} finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
console.log('PASS: Today uses local dates across midnight in three timezones, preserves time and defaults to 17:00; date-only supported.');
