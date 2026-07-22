import type { EdgePose, Chaser, LatLng, MazeGraph } from "../types";
import {
  createChasers,
  endFrighten,
  frightenChasers,
  pickSpawnPose,
  resetChasers,
  updateChaser,
} from "./chasers";
import { createInput } from "./input";
import { actorsTouching, advancePose, poseWorld } from "./movement";
import { drawFrame, resizeCanvas, type RenderContext } from "./render";
import type L from "leaflet";

export type GameCallbacks = {
  onScore: (score: number, lives: number, status: string) => void;
  onEnd: (result: "won" | "lost") => void;
};

export type GameSession = {
  stop: () => void;
};

const PLAYER_SPEED = 55;
const CHASER_SPEED = 42;
const FRIGHT_SPEED = 28;
const TOUCH_R = 8;
const PELLET_R = 6;
const STARTING_LIVES = 5;
const READY_SECONDS = 2;

export function startGame(
  map: L.Map,
  maze: MazeGraph,
  origin: LatLng,
  canvas: HTMLCanvasElement,
  callbacks: GameCallbacks,
): GameSession {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  resizeCanvas(canvas);
  canvas.classList.remove("hidden");

  const input = createInput();
  input.attach();

  let player: EdgePose = pickSpawnPose(maze);
  const chasers: Chaser[] = createChasers(maze);
  let score = 0;
  let lives = STARTING_LIVES;
  let status = "Get ready…";
  let running = true;
  let last = performance.now();
  let mouthPhase = 0;
  let mode: "scatter" | "chase" = "scatter";
  let modeTimer = 0;
  let frightTimer = 0;
  let invuln = 0;
  let readyTimer = READY_SECONDS;
  let raf = 0;

  const rc: RenderContext = { canvas, ctx, map, origin };

  const onResize = () => resizeCanvas(canvas);
  window.addEventListener("resize", onResize);

  const emit = () => callbacks.onScore(score, lives, status);

  const activeChasers = () => chasers.filter((g) => g.state !== "gone");

  const resetPositions = () => {
    player = pickSpawnPose(maze);
    resetChasers(maze, chasers);
    invuln = 0;
    readyTimer = READY_SECONDS;
    status = "Get ready…";
    input.state.desired = null;
  };

  const tick = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    mouthPhase += dt * 8;
    const live = activeChasers();

    if (readyTimer > 0) {
      readyTimer -= dt;
      const secs = Math.max(1, Math.ceil(readyTimer));
      status = readyTimer > 0 ? `Get ready… ${secs}` : "Go!";
      if (readyTimer <= 0) {
        readyTimer = 0;
        status = "Go!";
        invuln = 0.4;
      }
      emit();
      drawFrame(rc, maze, player, live, 0.5 + 0.5 * Math.sin(mouthPhase), false);
      raf = requestAnimationFrame(tick);
      return;
    }

    modeTimer += dt;
    if (frightTimer > 0) {
      frightTimer -= dt;
      if (frightTimer <= 0) {
        frightTimer = 0;
        endFrighten(chasers, mode);
        if (status === "Power!") status = "";
      }
    } else if (modeTimer > (mode === "scatter" ? 7 : 20)) {
      mode = mode === "scatter" ? "chase" : "scatter";
      modeTimer = 0;
      for (const g of chasers) {
        if (g.state === "scatter" || g.state === "chase") g.state = mode;
      }
    }

    if (invuln > 0) invuln -= dt;

    const { pose } = advancePose(
      maze,
      player,
      PLAYER_SPEED * dt,
      input.state.desired,
    );
    player = pose;

    const pp = poseWorld(maze, player);
    for (const pellet of maze.pellets) {
      if (pellet.eaten) continue;
      if (Math.hypot(pellet.x - pp.x, pellet.y - pp.y) <= PELLET_R) {
        pellet.eaten = true;
        if (pellet.power) {
          score += 50;
          frightTimer = 6;
          frightenChasers(chasers);
          status = "Power!";
        } else {
          score += 10;
        }
      }
    }

    const leader = live.find((g) => g.role === "rusher") ?? live[0];
    for (const g of live) {
      let spd = CHASER_SPEED;
      if (g.state === "frightened") spd = FRIGHT_SPEED;
      updateChaser(
        maze,
        g,
        player,
        leader?.pose ?? g.pose,
        mode,
        dt,
        spd,
      );

      if (invuln > 0) continue;
      if (!actorsTouching(maze, player, g.pose, TOUCH_R)) continue;

      if (g.state === "frightened") {
        g.state = "gone";
        score += 200;
        status = "Cone cleared!";
      } else {
        lives -= 1;
        status = lives > 0 ? "Ouch!" : "Game over";
        emit();
        if (lives <= 0) {
          running = false;
          drawFrame(
            rc,
            maze,
            player,
            activeChasers(),
            0.5 + 0.5 * Math.sin(mouthPhase),
            frightTimer > 0 && Math.floor(frightTimer * 8) % 2 === 0,
          );
          callbacks.onEnd("lost");
          return;
        }
        resetPositions();
      }
    }

    const remaining = maze.pellets.some((p) => !p.eaten);
    emit();

    drawFrame(
      rc,
      maze,
      player,
      activeChasers(),
      0.5 + 0.5 * Math.sin(mouthPhase),
      frightTimer > 0 && Math.floor(frightTimer * 8) % 2 === 0,
    );

    if (!remaining) {
      running = false;
      status = "Streets cleared!";
      emit();
      callbacks.onEnd("won");
      return;
    }

    raf = requestAnimationFrame(tick);
  };

  emit();
  raf = requestAnimationFrame(tick);

  return {
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
      input.detach();
      window.removeEventListener("resize", onResize);
      canvas.classList.add("hidden");
      const c = canvas.getContext("2d");
      c?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
