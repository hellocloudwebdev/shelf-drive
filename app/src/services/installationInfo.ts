import { settings } from '../api/index';

export interface InstallationInfo {
    managedByPackageManager: boolean;
    packageManager: 'pacman' | null;
}

export const RELEASES_URL = 'https://github.com/hellocloudwebdev/shelf-drive/releases/latest';

const SELF_MANAGED_INSTALLATION: InstallationInfo = {
    managedByPackageManager: false,
    packageManager: null,
};

let installationInfoPromise: Promise<InstallationInfo> | null = null;

export function getInstallationInfo(): Promise<InstallationInfo> {
    if (!installationInfoPromise) {
        installationInfoPromise = settings.getInstallationInfo()
            .catch(() => SELF_MANAGED_INSTALLATION);
    }
    return installationInfoPromise;
}
