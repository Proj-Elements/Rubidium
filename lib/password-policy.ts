export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 300;

export function passwordValidationMessage(password: string): string | null {
  if (password.length > MAX_PASSWORD_LENGTH) return `密码最多 ${MAX_PASSWORD_LENGTH} 个字符`;
  if (password.trim() !== password) return "密码不能以空格开头或结尾";
  if (password.length < MIN_PASSWORD_LENGTH) return `至少需要 ${MIN_PASSWORD_LENGTH} 个字符（当前 ${password.length} 个）`;
  return null;
}
