/**
 * setInterval that only runs while the tab is visible.
 *
 * A tab left in the background used to keep polling the server every 30–60
 * seconds, all night: that alone could spend the database's daily read budget.
 * This skips ticks while the page is hidden and runs once when it comes back,
 * so the data is fresh the moment someone looks.
 */
export function everyVisible(fn: () => void, ms: number): () => void {
  let missed = false;
  const id = window.setInterval(() => {
    if (document.hidden) missed = true;
    else fn();
  }, ms);
  const onVisible = () => {
    if (!document.hidden && missed) {
      missed = false;
      fn();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
