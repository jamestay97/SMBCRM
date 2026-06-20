const STEM_SUFFIXES = ["ing", "tion", "ment", "ies", "es", "ed", "er", "s"];

export function scopeWordsMatch(a: string, b: string): boolean {
  const left = a.toLowerCase().trim();
  const right = b.toLowerCase().trim();

  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  const minPrefix = shorter.length >= 4 ? 4 : 3;

  if (shorter.length >= minPrefix && longer.startsWith(shorter)) {
    return true;
  }

  const stem = (word: string) => {
    for (const suffix of STEM_SUFFIXES) {
      if (word.endsWith(suffix) && word.length > suffix.length + 2) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  };

  const leftStem = stem(left);
  const rightStem = stem(right);

  if (leftStem.length >= 3 && rightStem.length >= 3) {
    if (leftStem === rightStem) return true;
    if (leftStem.startsWith(rightStem) || rightStem.startsWith(leftStem)) {
      return true;
    }
  }

  return false;
}
