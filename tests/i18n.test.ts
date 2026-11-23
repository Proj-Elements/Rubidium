import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inferLocaleFromRequest, isLocale, isMessageKey, LOCALES, localeTables, translate, type Locale } from "../lib/i18n";

test("locale files do not silently overwrite duplicate message keys", () => {
  for (const locale of LOCALES) {
    const source = readFileSync(new URL(`../lib/locales/${locale}.json`, import.meta.url), "utf8");
    const keys = new Set<string>();
    for (const match of source.matchAll(/^\s*("(?:[^"\\]|\\.)+")\s*:/gm)) {
      const key = JSON.parse(match[1]) as string;
      assert.ok(!keys.has(key), `${locale}: duplicate message key ${key}`);
      keys.add(key);
    }
    assert.deepEqual([...keys].sort(), Object.keys(localeTables[locale]).sort());
  }
});

test("archived status labels remain distinct from the archive success message", () => {
  const labels = { "zh-CN": "已归档", "zh-TW": "已歸檔", en: "Archived" };
  for (const locale of LOCALES) {
    assert.equal(translate(locale, "taskStatus.archived"), labels[locale]);
    assert.notEqual(translate(locale, "taskStatus.archivedToast"), labels[locale]);
  }
});

test("locale preference prioritizes saved choices, trusted country, then accepted languages", () => {
  assert.equal(inferLocaleFromRequest({ savedLocale: "zh-TW", ipCountry: "CN", trustProxy: true }), "zh-TW");
  assert.equal(inferLocaleFromRequest({ ipCountry: "CN", trustProxy: true, acceptLanguage: "en-US" }), "zh-CN");
  assert.equal(inferLocaleFromRequest({ ipCountry: "TW", trustProxy: true, acceptLanguage: "en-US" }), "zh-TW");
  assert.equal(inferLocaleFromRequest({ ipCountry: "GB", trustProxy: true }), "en");
  assert.equal(inferLocaleFromRequest({ ipCountry: "CN", acceptLanguage: "zh-Hant, en;q=0.9" }), "zh-TW");
  assert.equal(inferLocaleFromRequest({ ipCountry: "CN", acceptLanguage: "en-US,en;q=0.8,zh;q=0" }), "en");
  assert.equal(inferLocaleFromRequest({ ipCountry: "CN", acceptLanguage: "fr-FR" }), "zh-CN");
  assert.equal(inferLocaleFromRequest({ savedLocale: "fr", ipCountry: "CN", trustProxy: false }), "zh-CN");
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("fr"), false);
});

test("each locale has independent stable keys and matching interpolation variables", () => {
  const tables = LOCALES.map((locale) => localeTables[locale]) as Array<Record<string, string>>;
  const expectedKeys = Object.keys(tables[0]).sort();
  for (const table of tables) {
    assert.deepEqual(Object.keys(table).sort(), expectedKeys);
    for (const value of Object.values(table)) assert.equal(typeof value, "string");
  }
  for (const key of expectedKeys) {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(tables[1][key]), placeholders(tables[0][key]), `${key} zh-CN/zh-TW`);
    assert.deepEqual(placeholders(tables[2][key]), placeholders(tables[0][key]), `${key} zh-CN/en`);
    assert.equal(isMessageKey(key), true);
  }
  assert.equal(isMessageKey("简体中文"), false);
  for (const locale of LOCALES as readonly Locale[]) {
    assert.equal(translate(locale, "password.tooShort", { minimum: 8, count: 5 }).includes("{minimum}"), false);
    assert.equal(translate(locale, "password.tooShort", { minimum: 8, count: 5 }).includes("{count}"), false);
  }
});

