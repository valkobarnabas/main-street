let toastTimer = 0;

export function showToast(message: string, ms = 3200): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.add("hidden");
  }, ms);
}

export function setHud(score: number, lives: number, status: string): void {
  const scoreEl = document.getElementById("hud-score");
  const livesEl = document.getElementById("hud-lives");
  const statusEl = document.getElementById("hud-status");
  if (scoreEl) scoreEl.textContent = `Score: ${score}`;
  if (livesEl) livesEl.textContent = `Lives: ${lives}`;
  if (statusEl) statusEl.textContent = status;
}

export function setPlayingUi(playing: boolean): void {
  document.body.classList.toggle("playing", playing);
  document.getElementById("hud")?.classList.toggle("hidden", !playing);
  document.getElementById("play-fab")?.classList.toggle("playing", playing);
}
