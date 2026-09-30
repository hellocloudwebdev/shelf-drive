import { shares } from '../api/index';
import type { ShareInfo, TelegramFile } from '../types';
import { sourceFolder } from './fileIdentity';

export type ShareLink = { file: TelegramFile; link: string };

export async function createOwnedShare(
    ownerId: string,
    file: TelegramFile,
    fallbackFolder: number | null,
    password: string | null,
    expiryHours: number | null,
): Promise<ShareInfo> {
    if (!ownerId) throw new Error('ACCOUNT_REQUIRED');
    // The backend accepts a null expiry (Option<i64>); the facade narrows the type to number.
    const result = await shares.create({
        ownerId, folderId: sourceFolder(file, fallbackFolder), messageId: file.id,
        fileName: file.name, fileSize: file.size, password, expiryHours: expiryHours as number,
    });
    // An old/unassigned record is never silently adopted by the visible account.
    if (result.owner_id !== ownerId) throw new Error('ACCOUNT_CHANGED');
    return result;
}

export async function createOwnedShareLinks(ownerId: string, files: TelegramFile[], folderId: number | null, isCurrent: () => boolean) {
    const errors: Array<{ file: TelegramFile; error: unknown }> = [];
    const links = await Promise.all(files.map(async file => {
        if (!isCurrent()) return null;
        try {
            const share = await createOwnedShare(ownerId, file, folderId, null, 24);
            return isCurrent() ? { file, link: share.link } : null;
        } catch (error) {
            if (isCurrent()) errors.push({ file, error });
            return null;
        }
    }));
    return { links: isCurrent() ? links.filter((link): link is ShareLink => link !== null) : [], errors: isCurrent() ? errors : [] };
}
