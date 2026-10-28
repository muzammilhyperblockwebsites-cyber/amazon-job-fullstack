"use client";

import { useEffect, useCallback, useState } from "react";

export type NotifPermission = "granted" | "denied" | "default" | "unsupported";

// Persistent global audio instances so mobile (iOS Safari / Android Chrome) and desktop
// stay unlocked after the user's first tap/click anywhere on the page.
let sharedAudioCtx: AudioContext | null = null;
let sharedAlarmAudio: HTMLAudioElement | null = null;
let sharedWavUrl: string | null = null;
let audioUnlocked = false;
let swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Generates a loud 3.2-second 8-pulse alternating alarm siren as a 16-bit PCM WAV Blob URL.
 * Using a real WAV <audio> element ensures mobile browsers (iOS/Android) and backgrounded
 * desktop tabs play the alarm reliably even when Web Audio oscillators are throttled.
 */
function getAlarmWavUrl(): string | null {
  if (typeof window === "undefined") return null;
  if (sharedWavUrl) return sharedWavUrl;

  try {
    const sampleRate = 22050;
    const durationSec = 3.2;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // WAV Header
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);

    const frequencies = [880, 1320, 880, 1320, 987.77, 1480, 987.77, 1480];
    const pulseDur = 0.33;
    const gap = 0.06;
    const cycleSlot = pulseDur + gap;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const slotIdx = Math.floor(t / cycleSlot);
      const timeInSlot = t - slotIdx * cycleSlot;
      let sample = 0;

      if (slotIdx < frequencies.length && timeInSlot <= pulseDur) {
        const freq = frequencies[slotIdx];
        // Rich harmonic alarm waveform (fundamental + octave overtone)
        const env = Math.min(1, (pulseDur - timeInSlot) / 0.04);
        const w1 = Math.sin(2 * Math.PI * freq * t);
        const w2 = 0.5 * Math.sin(2 * Math.PI * (freq * 1.5) * t);
        sample = Math.max(-1, Math.min(1, (w1 + w2) * 0.85 * env));
      }

      view.setInt16(44 + i * 2, Math.floor(sample * 32767), true);
    }

    const blob = new Blob([buffer], { type: "audio/wav" });
    sharedWavUrl = URL.createObjectURL(blob);
    return sharedWavUrl;
  } catch {
    return null;
  }
}

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedAudioCtx && sharedAudioCtx.state !== "closed") {
    return sharedAudioCtx;
  }
  const AudioContextClass =
    window.AudioContext ||
    (
      window as unknown as {
        webkitAudioContext: typeof window.AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    sharedAudioCtx = new AudioContextClass();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function getOrCreateAlarmAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (sharedAlarmAudio) return sharedAlarmAudio;
  const wavUrl = getAlarmWavUrl();
  if (!wavUrl) return null;
  try {
    const audio = new Audio(wavUrl);
    audio.preload = "auto";
    audio.volume = 1.0;
    audio.setAttribute("playsinline", "true");
    sharedAlarmAudio = audio;
    return audio;
  } catch {
    return null;
  }
}

/**
 * Unlocks Web Audio API + HTMLAudioElement on the first user touch/click/key gesture
 * so subsequent background polls and SSE notifications can play loud sound on Mobile & Desktop.
 */
export function unlockAudioOnGesture() {
  if (typeof window === "undefined") return;
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      if (!audioUnlocked) {
        const silentBuf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(ctx.destination);
        src.start(0);
      }
    }

    const audio = getOrCreateAlarmAudioElement();
    if (audio && !audioUnlocked) {
      audio.muted = true;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          audio.volume = 1.0;
          audioUnlocked = true;
        }).catch(() => {
          audio.muted = false;
        });
      }
    } else {
      audioUnlocked = true;
    }
  } catch {
    // ignore
  }
}

/**
 * Manages browser Notification API permission + firing loud mobile/desktop sound alerts.
 */
export function useNotifications(enabled = true) {
  const [permission, setPermission] = useState<NotifPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Register Service Worker for Mobile (Android Chrome / PWA) notifications + sound
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw-notifications.js")
        .then((reg) => {
          swRegistration = reg;
        })
        .catch(() => {});
    }

    // Unlock audio on any user tap/click/key across mobile & desktop
    const handleGesture = () => {
      unlockAudioOnGesture();
    };
    window.addEventListener("touchstart", handleGesture, { passive: true });
    window.addEventListener("touchend", handleGesture, { passive: true });
    window.addEventListener("pointerdown", handleGesture, { passive: true });
    window.addEventListener("click", handleGesture, { passive: true });
    window.addEventListener("keydown", handleGesture, { passive: true });

    const syncInitialPermission = setTimeout(() => {
      if (!("Notification" in window)) {
        setPermission("unsupported");
      } else {
        setPermission(Notification.permission as NotifPermission);
      }
    }, 0);

    if ("Notification" in window && Notification.permission === "default" && enabled) {
      const autoRequest = () => {
        unlockAudioOnGesture();
        Notification.requestPermission()
          .then((res) => setPermission(res as NotifPermission))
          .catch(() => {});
      };
      window.addEventListener("click", autoRequest, { once: true });
      window.addEventListener("touchend", autoRequest, { once: true });
    }

    return () => {
      clearTimeout(syncInitialPermission);
      window.removeEventListener("touchstart", handleGesture);
      window.removeEventListener("touchend", handleGesture);
      window.removeEventListener("pointerdown", handleGesture);
      window.removeEventListener("click", handleGesture);
      window.removeEventListener("keydown", handleGesture);
    };
  }, [enabled]);

  /** Play a loud, unmistakable multi-burst job alarm siren on both Mobile & Desktop */
  const beep = useCallback(() => {
    if (typeof window === "undefined") return;

    // 1. Mobile vibration pattern (works on Android phones)
    try {
      if ("vibrate" in navigator) {
        navigator.vibrate([500, 150, 500, 150, 500, 150, 800]);
      }
    } catch {
      // ignore
    }

    // 2. Play real PCM WAV <audio> siren (best compatibility on Mobile iOS/Android & background tabs)
    try {
      const audio = getOrCreateAlarmAudioElement();
      if (audio) {
        audio.muted = false;
        audio.volume = 1.0;
        audio.currentTime = 0;
        void audio.play().catch(() => {
          // If shared audio was busy, spawn a fresh Audio instance with the cached WAV blob
          const wavUrl = getAlarmWavUrl();
          if (wavUrl) {
            const fallbackAudio = new Audio(wavUrl);
            fallbackAudio.volume = 1.0;
            void fallbackAudio.play().catch(() => {});
          }
        });
      }
    } catch {
      // ignore
    }

    // 3. Also play Web Audio API siren on the unlocked AudioContext for maximum desktop/mobile loudness
    try {
      const ctx = getOrCreateAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }

      const start = ctx.currentTime + 0.02;
      const frequencies = [880, 1320, 880, 1320, 987.77, 1480, 987.77, 1480];
      const pulseDuration = 0.32;
      const gap = 0.06;

      frequencies.forEach((freq, idx) => {
        const pulseStart = start + idx * (pulseDuration + gap);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, pulseStart);

        gain.gain.setValueAtTime(0.75, pulseStart);
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          pulseStart + pulseDuration
        );

        osc.start(pulseStart);
        osc.stop(pulseStart + pulseDuration);
      });
    } catch {
      // audio not available
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined") return;
    unlockAudioOnGesture();
    beep();
    if (!("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotifPermission);
    } catch {
      // ignore
    }
  }, [beep]);

  /**
   * Fire a browser notification + loud alarm sound immediately on both Mobile and Desktop.
   */
  const notify = useCallback(
    (
      title: string,
      options?: { body?: string; tag?: string; url?: string }
    ) => {
      if (!enabled) return;
      beep();

      if (typeof window === "undefined" || !("Notification" in window)) {
        return;
      }

      const notifTag = options?.tag ?? `amazon-job-${Date.now()}`;
      const notifOptions: NotificationOptions & {
        renotify?: boolean;
        vibrate?: number[];
      } = {
        body: options?.body,
        tag: notifTag,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        silent: false,
        requireInteraction: true,
        renotify: true,
        vibrate: [500, 150, 500, 150, 500, 150, 800],
        data: { url: options?.url },
      };

      const showNativeNotification = () => {
        // Prefer ServiceWorkerRegistration.showNotification (required on Android Mobile Chrome!)
        if (swRegistration && "showNotification" in swRegistration) {
          swRegistration
            .showNotification(title, notifOptions)
            .catch(() => {
              try {
                const n = new Notification(title, notifOptions);
                if (options?.url) {
                  n.onclick = () => {
                    window.open(options.url, "_blank");
                    n.close();
                  };
                }
              } catch {
                // ignore
              }
            });
          return;
        }

        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.ready
            .then((reg) => {
              swRegistration = reg;
              return reg.showNotification(title, notifOptions);
            })
            .catch(() => {
              try {
                const n = new Notification(title, notifOptions);
                if (options?.url) {
                  n.onclick = () => {
                    window.open(options.url, "_blank");
                    n.close();
                  };
                }
              } catch {
                // ignore
              }
            });
          return;
        }

        try {
          const n = new Notification(title, notifOptions);
          if (options?.url) {
            n.onclick = () => {
              window.open(options.url, "_blank");
              n.close();
            };
          }
        } catch {
          // ignore
        }
      };

      if (Notification.permission === "granted") {
        showNativeNotification();
      } else if (Notification.permission === "default") {
        Notification.requestPermission()
          .then((res) => {
            setPermission(res as NotifPermission);
            if (res === "granted") {
              showNativeNotification();
            }
          })
          .catch(() => {});
      }
    },
    [enabled, beep]
  );

  return { permission, requestPermission, notify, beep };
}
