type PromptTranslations = Record<string, unknown>;

export type LocalizablePrompt = {
  text: string;
  translations: unknown;
};

function asTranslations(value: unknown): PromptTranslations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PromptTranslations;
}

export function localizePrompt(prompt: LocalizablePrompt, localeValue: string | null | undefined): string {
  const locale = localeValue === "tr" ? "tr" : "en";
  if (locale === "en") return prompt.text;

  const translated = asTranslations(prompt.translations)[locale];
  return typeof translated === "string" && translated.trim() ? translated : prompt.text;
}

export function localizePromptText(
  text: string | null | undefined,
  catalog: LocalizablePrompt[],
  localeValue: string | null | undefined,
): string | null {
  if (!text) return null;
  const prompt = catalog.find((candidate) => candidate.text === text);
  return prompt ? localizePrompt(prompt, localeValue) : text;
}
