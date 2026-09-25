export const visibleProviders = (providers: string[], flags: { gmail?: boolean }): string[] =>
  providers.filter((provider) => provider !== 'gmail' || flags.gmail !== false);
