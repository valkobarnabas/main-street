import type { DesiredDir } from "../types";

export type InputState = {
  desired: DesiredDir;
};

export function createInput(): {
  state: InputState;
  attach: () => void;
  detach: () => void;
} {
  const state: InputState = { desired: null };
  const pressed = new Set<string>();

  const sync = () => {
    if (pressed.has("ArrowUp") || pressed.has("w") || pressed.has("W")) {
      state.desired = "up";
    } else if (pressed.has("ArrowDown") || pressed.has("s") || pressed.has("S")) {
      state.desired = "down";
    } else if (pressed.has("ArrowLeft") || pressed.has("a") || pressed.has("A")) {
      state.desired = "left";
    } else if (pressed.has("ArrowRight") || pressed.has("d") || pressed.has("D")) {
      state.desired = "right";
    }
    // Keep last desired while key held; buffer last intent like arcade mazes
  };

  const onDown = (e: KeyboardEvent) => {
    const keys = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "a",
      "s",
      "d",
      "W",
      "A",
      "S",
      "D",
    ];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    pressed.add(e.key);
    // Always update desired on fresh press (buffering)
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") state.desired = "up";
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S")
      state.desired = "down";
    else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A")
      state.desired = "left";
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D")
      state.desired = "right";
  };

  const onUp = (e: KeyboardEvent) => {
    pressed.delete(e.key);
    sync();
  };

  return {
    state,
    attach: () => {
      window.addEventListener("keydown", onDown);
      window.addEventListener("keyup", onUp);
    },
    detach: () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      pressed.clear();
      state.desired = null;
    },
  };
}
