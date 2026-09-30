import { workspace } from '../api/index';

/** Read the verified session owner on every boundary; never cache across logout. */
export function getCurrentAccountId(): Promise<string> {
    return workspace.account();
}
