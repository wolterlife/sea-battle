import assert from "node:assert/strict";
import {
  FLEET,
  applyFog,
  canPlace,
  clampOrigin,
  emptyBoard,
  emptyFog,
  fireAt,
  fleetComplete,
  placeShip,
  placementLegal,
  randomBoard,
  sunkShips,
} from "../js/engine.js";

function placeSpec(board, spec, x, y, dir) {
  assert.equal(placeShip(board, spec.id, spec.len, x, y, dir), true);
}

const board = emptyBoard();
assert.equal(canPlace(board, 7, 0, 4, "h"), false);
assert.equal(canPlace(board, 6, 0, 4, "h"), true);
placeSpec(board, FLEET[6], 0, 0, "h");
assert.equal(canPlace(board, 1, 1, 1, "h"), false);
assert.equal(canPlace(board, 0, 1, 1, "h"), false);
assert.equal(canPlace(board, 0, 2, 1, "h"), true);
assert.equal(canPlace(board, 2, 2, 1, "h"), true);
assert.deepEqual(clampOrigin(8, 0, 4, "h"), { x: 6, y: 0 });

for (let i = 0; i < 25; i += 1) {
  const sample = randomBoard();
  assert.equal(fleetComplete(sample), true);
  assert.equal(placementLegal(sample), true);
}

const duel = emptyBoard();
placeShip(duel, "1a", 1, 0, 0, "h");
placeShip(duel, "1b", 1, 3, 3, "h");
let shot = fireAt(duel, 5, 5);
assert.equal(shot.hit, false);
assert.equal(fireAt(duel, 5, 5).error, "repeat");
shot = fireAt(duel, 0, 0);
assert.equal(shot.sunk, true);
assert.equal(shot.win, false);
assert.ok(shot.misses.some((cell) => cell.x === 1 && cell.y === 1));
assert.equal(sunkShips(duel), 1);
shot = fireAt(duel, 3, 3);
assert.equal(shot.win, true);

const fog = emptyFog();
applyFog(fog, shot);
assert.equal(fog[3][3], "sunk");
assert.equal(fog[5][5], "unknown");
applyFog(fog, { x: 5, y: 5, hit: false, sunk: false, sunkCells: [], misses: [{ x: 5, y: 5 }] });
assert.equal(fog[5][5], "miss");

const liner = emptyBoard();
placeShip(liner, "4", 4, 0, 5, "h");
assert.equal(fireAt(liner, 0, 5).sunk, false);
assert.equal(fireAt(liner, 1, 5).sunk, false);
assert.equal(fireAt(liner, 2, 5).hit, true);
const last = fireAt(liner, 3, 5);
assert.equal(last.sunk, true);
assert.equal(last.win, true);
assert.equal(last.len, 4);

console.log("engine ok");
