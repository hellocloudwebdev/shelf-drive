import { sync } from '../api/index';
import type { ConflictResolution, SyncPairSaveOptions, SyncPreviewRequest } from '../types/sync';

export const getSyncSettings = (ownerId: string) => sync.getSettings(ownerId);
export const toggleSync = (enabled: boolean, ownerId: string) => sync.toggle(enabled, ownerId);
export const getSyncPairs = (ownerId: string) => sync.listPairs(ownerId);
export const addSyncPair = (localPath: string, channelId: number, label: string | undefined, options: SyncPairSaveOptions, ownerId: string) => sync.addPair({
  localPath,
  channelId,
  label,
  ...options,
  ownerId,
});
export const previewSyncPair = (request: SyncPreviewRequest, ownerId: string) => sync.previewPair(request, ownerId);
export const updateSyncPair = (request: SyncPreviewRequest, previewToken: string, isActive: boolean, ownerId: string) => sync.updatePair(request, previewToken, isActive, ownerId);
export const setSyncPairActive = (pairId: number, isActive: boolean, ownerId: string) => sync.setPairActive(pairId, isActive, ownerId);
export const removeSyncPair = (pairId: number, ownerId: string) => sync.removePair(pairId, ownerId);
export const getSyncStatus = (ownerId: string) => sync.getStatus(ownerId);
export const getSyncConflicts = (ownerId: string) => sync.getConflicts(ownerId);
export const getSyncLog = (ownerId: string, limit = 100) => sync.getLog(ownerId, limit);
export const resolveSyncConflict = (pairId: number, path: string, resolution: ConflictResolution, ownerId: string) => sync.resolveConflict(pairId, path, resolution, ownerId);
