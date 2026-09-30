import { android } from '../api/index';

export async function requireAndroidReauthentication(reason: string): Promise<void> {
  let androidPlatform = false;
  try {
    const { type } = await import('@tauri-apps/plugin-os');
    androidPlatform = type() === 'android';
  } catch {
    // Browser tests and non-Tauri previews have no Android bridge.
    return;
  }
  if (!androidPlatform) return;
  const available = await android.isAuthenticationAvailable();
  if (!available) return;
  const authenticated = await android.authenticate(reason);
  if (!authenticated) throw new Error('Android authentication was cancelled');
}
