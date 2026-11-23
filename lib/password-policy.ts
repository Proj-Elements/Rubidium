import type { MessageKey } from "./i18n";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 300;
export const MIN_TRANSFER_PASSWORD_LENGTH = 12;
export const MAX_TRANSFER_PASSWORD_LENGTH = 200;

export function transferPasswordValidationIssue(passphrase: string): MessageKey | null {
  if (passphrase.length === 0) return "transfer.encryptionPasswordRequired";
  if (passphrase.length < MIN_TRANSFER_PASSWORD_LENGTH) return "transfer.encryptionPasswordTooShort";
  if (passphrase.length > MAX_TRANSFER_PASSWORD_LENGTH) return "transfer.encryptionPasswordTooLong";
  if (passphrase.trim() !== passphrase) return "transfer.encryptionPasswordWhitespace";
  return null;
}

export function passwordValidationIssue(password: string): { key: MessageKey; values?: Record<string, number> } | null {
  if (password.length > MAX_PASSWORD_LENGTH) return { key: "password.tooLong", values: { count: MAX_PASSWORD_LENGTH } };
  if (password.trim() !== password) return { key: "password.trimWhitespace" };
  if (password.length < MIN_PASSWORD_LENGTH) return { key: "password.tooShort", values: { minimum: MIN_PASSWORD_LENGTH, count: password.length } };
  return null;
}

export function passwordValidationMessage(password: string): string | null {
  const issue = passwordValidationIssue(password);
  if (issue?.key === "password.tooLong") return `密码最多 ${MAX_PASSWORD_LENGTH} 个字符`;
  if (issue?.key === "password.trimWhitespace") return "密码不能以空格开头或结尾";
  if (issue?.key === "password.tooShort") return `至少需要 ${MIN_PASSWORD_LENGTH} 个字符（当前 ${password.length} 个）`;
  return null;
}

export function passwordValidationLocalized(password: string) {
  const issue = passwordValidationIssue(password);
  return issue ? { key: issue.key, ...(issue.values ? { values: issue.values } : {}) } : undefined;
}
