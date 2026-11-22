import { cookies, headers } from "next/headers";
import { getEnvironmentVariable } from "./environment.mjs";
import { inferLocaleFromRequest, isLocale, LOCALE_COOKIE, type Locale } from "./i18n";

const trustedProxyValues = new Set(["1", "true", "yes"]);

export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(savedLocale)) return savedLocale;

  const trustProxy = trustedProxyValues.has((getEnvironmentVariable("TRUST_PROXY") ?? "").trim().toLowerCase());
  const ipCountry = trustProxy
    ? requestHeaders.get("x-vercel-ip-country") ?? requestHeaders.get("cf-ipcountry") ?? requestHeaders.get("fly-client-country")
    : null;

  return inferLocaleFromRequest({ savedLocale, ipCountry, trustProxy, acceptLanguage: requestHeaders.get("accept-language") });
}
