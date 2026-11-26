import { describe, expect, test } from 'bun:test';

import lock from '../package-lock.json';
import manifest from '../package.json';

// OpenChamber reads the tracker contribution from this file. A wrong key does
// not fail the build: it silently hides UI (the account switcher, project
// mapping, session comments), so pin what the extension relies on.

const tracker = manifest.openchamber.contributes.tracker;

describe('the tracker manifest', () => {
  test('declares the capabilities the host gates UI on', () => {
    expect(tracker.capabilities).toMatchObject({
      multipleAccounts: true,
      stateUpdate: true,
      children: true,
      labels: true,
      priority: true,
      projectMapping: true,
      sessionComments: true,
      filters: { people: true, priority: true },
    });
  });

  test('requires the first OpenChamber release that reads extension trackers', () => {
    expect(manifest.openchamber.engines.openchamber).toBe('>=2.8.0');
  });

  test('keeps the package and lock versions together', () => {
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[''].version).toBe(manifest.version);
  });
});
