/** Newest-first panel: pin to top while streaming unless the user scrolled down. */
export function pinStateOnScroll(scrollTop: number, threshold = 24): boolean {
  return scrollTop <= threshold;
}

export function scrollTopForAnswer(pinned: boolean, newAnswerStarted: boolean): number | null {
  if (newAnswerStarted || pinned) return 0;
  return null;
}
