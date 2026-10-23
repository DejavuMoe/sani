/** Match Go's NFC + simple lowercase, without contextual sigma or dotted-I expansion. */
export const lookupKey = (value: string) => Array.from(value.normalize('NFC'), char =>
  char === '\u0130' ? 'i' : char.toLowerCase()).join('');
