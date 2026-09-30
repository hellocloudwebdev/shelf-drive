import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { type as osType } from '@tauri-apps/plugin-os';
import { listen } from '@tauri-apps/api/event';
import { settings as settingsApi, vault } from '../api/index';
import { useSettings } from '../context/SettingsContext';
import { useVaultActivity } from './useVaultActivity';
import type {
    EncryptionCapabilities,
    EncryptionCapabilityState,
    EncryptionSettings,
    VaultStatus,
    FileEncryptionInfo,
    EncryptionState,
    CryptoInventory,
} from '../types';

interface EncryptionContextType {
    capabilities: EncryptionCapabilities | null;
    settings: EncryptionSettings | null;
    vaultStatus: VaultStatus | null;
    inventory: CryptoInventory | null;
    capabilityState: EncryptionCapabilityState;
    capabilityError: string | null;
    isLoaded: boolean;
    refreshCapabilities: () => Promise<void>;
    refreshVaultStatus: () => Promise<void>;
    refreshInventory: () => Promise<void>;
    unlockVault: (passphrase: string) => Promise<number>;
    lockVault: () => Promise<void>;
    createVault: (passphrase: string) => Promise<void>;
    changeVaultPassphrase: (newPassphrase: string) => Promise<void>;
    getFileEncryptionInfo: (messageId: number, folderId: number | null) => Promise<FileEncryptionInfo>;
    generateRecoveryKey: () => Promise<string>;
    exportRecovery: (recoveryPassphrase: string) => Promise<string>;
    importRecovery: (bundle: string, recoveryPassphrase: string) => Promise<void>;
}

const EncryptionContext = createContext<EncryptionContextType | undefined>(undefined);

export function EncryptionProvider({ children }: { children: ReactNode }) {
    const { settings: appSettings, isLoaded: appSettingsLoaded } = useSettings();
    const [capabilities, setCapabilities] = useState<EncryptionCapabilities | null>(null);
    const [settings, setSettings] = useState<EncryptionSettings | null>(null);
    const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
    const [inventory, setInventory] = useState<CryptoInventory | null>(null);
    const [capabilityState, setCapabilityState] = useState<EncryptionCapabilityState>('loading');
    const [capabilityError, setCapabilityError] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    useVaultActivity(vaultStatus?.is_unlocked === true);

    const refreshCapabilities = useCallback(async () => {
        setCapabilityState('loading');
        setCapabilityError(null);
        try {
            const caps = await vault.getEncryptionCapabilities();
            if (caps.contract_version !== 2) {
                throw new Error(`Unsupported encryption command contract ${String(caps.contract_version)}`);
            }
            setCapabilities(caps);
            setCapabilityState(
                caps.availability === 'ready'
                    ? 'ready'
                    : caps.availability === 'blocked'
                      ? 'blocked'
                      : caps.availability === 'disabled'
                        ? 'disabled'
                        : 'blocked',
            );
        } catch (error) {
            setCapabilities(null);
            setCapabilityError(String(error));
            setCapabilityState('error');
        }
    }, []);

    const refreshVaultStatus = useCallback(async () => {
        try {
            const status = await vault.getStatus();
            setVaultStatus(status);
        } catch {
            setVaultStatus(null);
        }
    }, []);

    const refreshInventory = useCallback(async () => {
        try {
            setInventory(await vault.getCryptoInventory());
        } catch {
            setInventory(null);
        }
    }, []);

    useEffect(() => {
        const load = async () => {
            await Promise.all([
                refreshCapabilities(),
                refreshVaultStatus(),
                refreshInventory(),
                vault.getEncryptionSettings().then(setSettings).catch(() => {}),
            ]);
            setIsLoaded(true);
        };
        load();
    }, [refreshCapabilities, refreshInventory, refreshVaultStatus]);

    useEffect(() => {
        if (!appSettingsLoaded) return;
        const effectiveSettings: EncryptionSettings = {
            default_mode: appSettings.encryptionDefaultMode,
            protect_metadata: appSettings.encryptionProtectMetadata,
            auto_lock_minutes: appSettings.encryptionAutoLockMinutes,
            lock_on_sleep: appSettings.encryptionLockOnSleep,
            temp_policy: appSettings.encryptionTempPolicy,
            remember_device: false,
        };
        vault.updateEncryptionSettings(effectiveSettings)
            .then(setSettings)
            .catch(error => {
                setCapabilityError(previous => previous ?? `Encryption settings were rejected: ${String(error)}`);
            });
    }, [
        appSettings.encryptionAutoLockMinutes,
        appSettings.encryptionDefaultMode,
        appSettings.encryptionLockOnSleep,
        appSettings.encryptionProtectMetadata,
        appSettings.encryptionTempPolicy,
        appSettingsLoaded,
    ]);

    useEffect(() => {
        if (!appSettingsLoaded) return;
        let mobile = false;
        try {
            const platform = osType();
            mobile = platform === 'android' || platform === 'ios';
        } catch {
            // Browser previews have no native sleep lifecycle.
            return;
        }
        if (!mobile) {
            void settingsApi.setDesktopLockOnSleep(appSettings.encryptionLockOnSleep).catch(() => {});
            return;
        }
        if (!appSettings.encryptionLockOnSleep) return;
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                void vault.lock().catch(() => {});
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [appSettings.encryptionLockOnSleep, appSettingsLoaded]);

    useEffect(() => {
        let cancelled = false;
        let unlisten: (() => void) | undefined;
        listen('vault-locked', () => {
            if (!cancelled) void refreshVaultStatus();
        }).then(dispose => {
            if (cancelled) dispose();
            else unlisten = dispose;
        }).catch(() => {
            // Capability diagnostics surface backend mismatches elsewhere.
        });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [refreshVaultStatus]);

    const unlockVault = useCallback(async (passphrase: string): Promise<number> => {
        const sessionId = await vault.unlock(passphrase);
        await refreshVaultStatus();
        return sessionId;
    }, [refreshVaultStatus]);

    const lockVault = useCallback(async () => {
        await vault.lock();
        await refreshVaultStatus();
    }, [refreshVaultStatus]);

    const createVault = useCallback(async (passphrase: string) => {
        await vault.create(passphrase);
        await refreshVaultStatus();
    }, [refreshVaultStatus]);

    const changeVaultPassphrase = useCallback(async (newPassphrase: string) => {
        await vault.changePassphrase(newPassphrase);
        await refreshVaultStatus();
    }, [refreshVaultStatus]);

    const getFileEncryptionInfo = useCallback(async (
        messageId: number,
        folderId: number | null,
    ): Promise<FileEncryptionInfo> => {
        // ownerId is intentionally omitted: the backend resolves the current
        // account when the field is absent from the IPC payload.
        return await vault.getFileEncryptionInfo(messageId, folderId, undefined as unknown as string);
    }, []);

    const generateRecoveryKey = useCallback(async (): Promise<string> => {
        return await vault.generateRecoveryKey();
    }, []);

    const exportRecovery = useCallback(async (recoveryPassphrase: string): Promise<string> => {
        return await vault.exportRecovery(recoveryPassphrase);
    }, []);

    const importRecovery = useCallback(async (
        bundle: string,
        recoveryPassphrase: string,
    ): Promise<void> => {
        await vault.importRecovery(bundle, recoveryPassphrase, true);
        await refreshVaultStatus();
    }, [refreshVaultStatus]);

    const contextValue: EncryptionContextType = {
        capabilities,
        settings,
        vaultStatus,
        inventory,
        capabilityState,
        capabilityError,
        isLoaded,
        refreshCapabilities,
        refreshVaultStatus,
        refreshInventory,
        unlockVault,
        lockVault,
        createVault,
        changeVaultPassphrase,
        getFileEncryptionInfo,
        generateRecoveryKey,
        exportRecovery,
        importRecovery,
    };

    return (
        <EncryptionContext.Provider value={contextValue}>
            {children}
        </EncryptionContext.Provider>
    );
}

export function useEncryption() {
    const ctx = useContext(EncryptionContext);
    if (!ctx) {
        throw new Error('useEncryption must be used within an EncryptionProvider');
    }
    return ctx;
}

export function resolveEncryptionState(
    info: FileEncryptionInfo | undefined,
    vaultUnlocked: boolean,
): EncryptionState {
    if (!info || info.state === 'plain') return 'plain';
    if (info.state === 'encrypted_verifying') return 'encrypted_verifying';
    if (info.state === 'encrypted_corrupt') return 'encrypted_corrupt';
    if (info.state === 'encrypted_unsupported_version') return 'encrypted_unsupported_version';
    if (info.state === 'encrypted_key_missing') return 'encrypted_key_missing';

    if (vaultUnlocked) return 'encrypted_unlocked';
    return 'encrypted_locked';
}
