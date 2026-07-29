export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Strip common formatting; keep leading + for E.164-ish values. */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function isEmailLike(value: string): boolean {
  return value.includes('@');
}
