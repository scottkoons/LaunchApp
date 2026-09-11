'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';

type AlertState = {
  ready: boolean;
  configured: boolean;
  publicKey: string;
  subscribed: boolean;
};
async function deviceId(subscription: PushSubscription | null) {
  if (!subscription) return '';
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(subscription.endpoint),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
async function phoneAction(body: object) {
  const response = await fetch('/api/phone-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(result.error || 'Could not connect alerts. Try again.');
  return result;
}
export function PhoneAlerts() {
  const [state, setState] = useState<AlertState | null>(null);
  const [support, setSupport] = useState<
    'checking' | 'available' | 'home-screen' | 'unsupported'
  >('checking');
  const [permission, setPermission] =
    useState<NotificationPermission>('default');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const working = useRef(false);
  const refresh = useCallback(async () => {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setSupport(
      ios && !standalone
        ? 'home-screen'
        : supported
          ? 'available'
          : 'unsupported',
    );
    if ('Notification' in window) setPermission(Notification.permission);
    const registration =
      'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration()
        : undefined;
    const subscription = registration?.pushManager
      ? await registration.pushManager.getSubscription()
      : null;
    const response = await fetch(
      '/api/phone-alerts?device=' + (await deviceId(subscription)),
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok)
      throw new Error(
        'Could not check phone alerts. Try again when you’re connected.',
      );
    setState((await response.json()) as AlertState);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('view') === 'phone-alerts')
      document.getElementById('phone-alerts')?.scrollIntoView();
    const check = () => {
      void refresh().catch((e: Error) => setError(e.message));
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [refresh]);
  async function act(action: 'enable' | 'test' | 'disable') {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Request permission directly from the tap, before any network request.
      if (action === 'enable') {
        const allowed = await Notification.requestPermission();
        setPermission(allowed);
        if (allowed !== 'granted')
          throw new Error(
            'Alerts are not allowed yet. You can turn them on in your phone’s notification settings.',
          );
      }
      const registration = await new Promise<ServiceWorkerRegistration>(
        (resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error('Close and reopen Launch, then try again.')),
            15000,
          );
          navigator.serviceWorker.ready.then((value) => {
            window.clearTimeout(timeout);
            resolve(value);
          }, reject);
        },
      );
      let subscription = await registration.pushManager.getSubscription();
      if (action === 'enable') {
        const encoded = state!.publicKey
          .replaceAll('-', '+')
          .replaceAll('_', '/');
        const key = Uint8Array.from(atob(encoded), (char) =>
          char.charCodeAt(0),
        );
        subscription ||= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await phoneAction({
          action: 'subscribe',
          subscription: subscription.toJSON(),
        });
        setMessage(
          'Alerts are enabled on this device. Send a test alert, then lock the screen.',
        );
      } else if (action === 'disable') {
        await phoneAction({ action, deviceId: await deviceId(subscription) });
        await subscription?.unsubscribe();
        setMessage(
          'Alerts are off on this device. Your reminders are still saved.',
        );
      } else {
        await phoneAction({ action, deviceId: await deviceId(subscription) });
        setMessage(
          'Lock your phone now. A test alert should arrive in about a minute.',
        );
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const enabled = state?.subscribed && permission === 'granted';
  return (
    <section
      className="settings-section phone-alert-settings"
      id="phone-alerts"
      aria-label="Phone alerts"
    >
      <h2>
        <Bell /> Phone alerts
      </h2>
      <p className="hint">
        Get a reminder on your lock screen when Launch is closed. Turn this on
        from Launch on your phone.
      </p>
      {support === 'checking' || !state ? (
        <p className="hint">Checking this device…</p>
      ) : support === 'home-screen' ? (
        <p>
          Open Launch using its Home Screen icon. If it opens in a browser tab,
          add it to your Home Screen again and turn on “Open as Web App.”
        </p>
      ) : support === 'unsupported' ? (
        <p>
          This browser cannot receive phone alerts. Open Launch from your
          phone’s Home Screen.
        </p>
      ) : !state.ready ? (
        <output>
          {state.configured
            ? 'The reminder service is not connected right now. Alerts may be delayed.'
            : 'Phone alert setup is still being finished. Your reminders remain saved in Launch.'}
        </output>
      ) : permission === 'denied' ? (
        <p>
          Open your phone’s Settings → Notifications → Launch and allow
          notifications. Then return here.
        </p>
      ) : (
        <>
          {enabled && (
            <p className="phone-alert-enabled">
              <Check /> Alerts enabled on this device
            </p>
          )}
          <div className="button-row">
            {enabled ? (
              <>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => void act('test')}
                >
                  Send a test alert
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void act('disable')}
                >
                  Turn off on this device
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => void act('enable')}
              >
                <Bell />
                {busy ? 'Connecting…' : 'Enable alerts on this device'}
              </button>
            )}
          </div>
        </>
      )}
      {message && <output>{message}</output>}
      {error && (
        <p className="reminder-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Sound and buzzing follow your phone’s notification settings. Allow
        Launch through Focus if you want its reminders during quiet time. New
        reminders must finish syncing before you close Launch.
      </p>
    </section>
  );
}
