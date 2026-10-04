interface Cooldown {
  expiresAt: number;
}

const cooldowns = new Map<string, Cooldown>();

export function getCooldownKey(userId: string, commandName: string): string {
  return `${userId}:${commandName}`;
}

export function setCooldown(
  userId: string,
  commandName: string,
  cooldownMs: number,
): void {
  const key = getCooldownKey(userId, commandName);
  cooldowns.set(key, {
    expiresAt: Date.now() + cooldownMs,
  });

  // Auto-cleanup after cooldown expires. unref: a pending cleanup must never
  // keep the process alive on its own.
  setTimeout(() => {
    cooldowns.delete(key);
  }, cooldownMs).unref?.();
}

export function getCooldown(userId: string, commandName: string): number {
  const key = getCooldownKey(userId, commandName);
  const cooldown = cooldowns.get(key);

  if (!cooldown) return 0;

  const remainingMs = cooldown.expiresAt - Date.now();
  return remainingMs > 0 ? remainingMs : 0;
}

export function hasCooldown(userId: string, commandName: string): boolean {
  return getCooldown(userId, commandName) > 0;
}

/**
 * Unified cooldown check, usable for both prefix and slash invocations since it
 * only needs a user ID. Returns true if the command may run; if the user is on
 * cooldown, `onCooldown` is called with the remaining seconds (as a string) and
 * this returns false.
 */
export async function checkCommandCooldown(
  userId: string,
  commandName: string,
  cooldownMs: number,
  onCooldown: (remainingSeconds: string) => Promise<unknown>,
): Promise<boolean> {
  if (hasCooldown(userId, commandName)) {
    const remaining = getCooldown(userId, commandName);
    await onCooldown((remaining / 1000).toFixed(1));
    return false;
  }

  setCooldown(userId, commandName, cooldownMs);
  return true;
}
