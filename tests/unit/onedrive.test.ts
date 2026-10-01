import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRegistryAccounts, recordingsDirFor, resolveOneDriveRoot, type OneDriveProbe } from '../../src/main/storage/onedrive';

function probe(env: Record<string, string | undefined>, existing: string[], registry: Array<{ key: string; userFolder: string }> = []): OneDriveProbe {
  const set = new Set(existing.map((p) => p.toLowerCase()));
  return {
    env,
    dirExists: async (p) => set.has(p.toLowerCase()),
    readRegistryAccounts: async () => registry
  };
}

const BUSINESS = 'C:\\Users\\someone\\OneDrive - Contoso';
const PERSONAL = 'C:\\Users\\someone\\OneDrive';

describe('resolveOneDriveRoot', () => {
  it('prefers %OneDrive% and recognises it as the business account', async () => {
    const r = await resolveOneDriveRoot(probe({ OneDrive: BUSINESS, OneDriveCommercial: BUSINESS, OneDriveConsumer: PERSONAL }, [BUSINESS, PERSONAL]));
    expect(r).toEqual({ root: BUSINESS, origin: 'env:OneDrive', accountType: 'business' });
  });

  it('falls back to OneDriveCommercial then OneDriveConsumer', async () => {
    expect((await resolveOneDriveRoot(probe({ OneDriveCommercial: BUSINESS }, [BUSINESS])))?.origin).toBe('env:OneDriveCommercial');
    const personal = await resolveOneDriveRoot(probe({ OneDriveConsumer: PERSONAL }, [PERSONAL]));
    expect(personal).toEqual({ root: PERSONAL, origin: 'env:OneDriveConsumer', accountType: 'personal' });
  });

  it('skips variables that point to folders that do not exist', async () => {
    const r = await resolveOneDriveRoot(probe({ OneDrive: 'C:\\gone', OneDriveConsumer: PERSONAL }, [PERSONAL]));
    expect(r?.root).toBe(PERSONAL);
  });

  it('uses the registry when no variable is set, business first', async () => {
    const r = await resolveOneDriveRoot(
      probe({}, [BUSINESS, PERSONAL], [
        { key: 'Personal', userFolder: PERSONAL },
        { key: 'Business1', userFolder: BUSINESS }
      ])
    );
    expect(r).toEqual({ root: BUSINESS, origin: 'registry', accountType: 'business' });
  });

  it('returns null when OneDrive is not set up', async () => {
    expect(await resolveOneDriveRoot(probe({}, []))).toBeNull();
  });

  it('builds <root>\\loom\\recording', () => {
    expect(recordingsDirFor(BUSINESS)).toBe(join(BUSINESS, 'loom', 'recording'));
  });

  it('parses registry output lines', () => {
    expect(parseRegistryAccounts(`Business1|${BUSINESS}\r\nPersonal|${PERSONAL}\r\n\r\nbroken`)).toEqual([
      { key: 'Business1', userFolder: BUSINESS },
      { key: 'Personal', userFolder: PERSONAL }
    ]);
  });
});
