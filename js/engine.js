export const SIZE = 10;
export const LETTERS = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К"];

export const FLEET = [
  { id: "4", len: 4, title: "Линкор" },
  { id: "3a", len: 3, title: "Крейсер" },
  { id: "3b", len: 3, title: "Крейсер" },
  { id: "2a", len: 2, title: "Эсминец" },
  { id: "2b", len: 2, title: "Эсминец" },
  { id: "2c", len: 2, title: "Эсминец" },
  { id: "1a", len: 1, title: "Катер" },
  { id: "1b", len: 1, title: "Катер" },
  { id: "1c", len: 1, title: "Катер" },
  { id: "1d", len: 1, title: "Катер" },
];

export function shipName(len) {
  return { 1: "катер", 2: "эсминец", 3: "крейсер", 4: "линкор" }[len] || "корабль";
}

export function coordName(x, y) {
  return `${LETTERS[x]}${y + 1}`;
}

export function emptyBoard() {
  return {
    cells: Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => ({ shipId: null, shot: false }))
    ),
    ships: {},
  };
}

export function emptyFog() {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => "unknown"));
}

export function shipCells(x, y, len, dir) {
  const cells = [];
  for (let i = 0; i < len; i += 1) {
    const cx = x + (dir === "h" ? i : 0);
    const cy = y + (dir === "v" ? i : 0);
    if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) return null;
    cells.push({ x: cx, y: cy });
  }
  return cells;
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

export function clampOrigin(x, y, len, dir) {
  const max = SIZE - len;
  if (dir === "h") return { x: Math.max(0, Math.min(max, x)), y: Math.max(0, Math.min(SIZE - 1, y)) };
  return { x: Math.max(0, Math.min(SIZE - 1, x)), y: Math.max(0, Math.min(max, y)) };
}

export function canPlace(board, x, y, len, dir, ignoreId = null) {
  const cells = shipCells(x, y, len, dir);
  if (!cells) return false;
  for (const cell of cells) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (!inside(nx, ny)) continue;
        const id = board.cells[ny][nx].shipId;
        if (id && id !== ignoreId) return false;
      }
    }
  }
  return true;
}

export function removeShip(board, id) {
  const ship = board.ships[id];
  if (!ship) return;
  for (const cell of ship.cells) {
    if (board.cells[cell.y][cell.x].shipId === id) board.cells[cell.y][cell.x].shipId = null;
  }
  delete board.ships[id];
}

export function placeShip(board, id, len, x, y, dir) {
  if (!canPlace(board, x, y, len, dir, id)) return false;
  removeShip(board, id);
  const cells = shipCells(x, y, len, dir);
  board.ships[id] = { id, len, dir, x, y, cells, hits: 0, sunk: false };
  for (const cell of cells) board.cells[cell.y][cell.x].shipId = id;
  return true;
}

export function fleetComplete(board) {
  return FLEET.every((spec) => board.ships[spec.id]);
}

export function placedCount(board) {
  return FLEET.reduce((sum, spec) => sum + (board.ships[spec.id] ? 1 : 0), 0);
}

export function randomBoard() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const board = emptyBoard();
    let ok = true;
    for (const spec of FLEET) {
      const spots = [];
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          for (const dir of ["h", "v"]) {
            if (canPlace(board, x, y, spec.len, dir)) spots.push({ x, y, dir });
          }
        }
      }
      if (!spots.length) {
        ok = false;
        break;
      }
      const spot = spots[(Math.random() * spots.length) | 0];
      placeShip(board, spec.id, spec.len, spot.x, spot.y, spot.dir);
    }
    if (ok && placementLegal(board)) return board;
  }
  throw new Error("Не удалось расставить флот");
}

export function placementLegal(board) {
  const ships = Object.values(board.ships);
  if (ships.length !== FLEET.length) return false;
  const seen = new Set();
  for (const ship of ships) {
    if (!ship.cells || ship.cells.length !== ship.len) return false;
    for (const cell of ship.cells) {
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (board.cells[cell.y][cell.x].shipId !== ship.id) return false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          if (!inside(nx, ny)) continue;
          const id = board.cells[ny][nx].shipId;
          if (id && id !== ship.id) return false;
        }
      }
    }
  }
  return seen.size === ships.reduce((sum, ship) => sum + ship.len, 0);
}

export function fireAt(board, x, y) {
  if (!inside(x, y)) return { error: "bounds" };
  const cell = board.cells[y][x];
  if (cell.shot) return { error: "repeat" };
  cell.shot = true;
  if (!cell.shipId) {
    return {
      x,
      y,
      hit: false,
      sunk: false,
      win: false,
      len: 0,
      sunkCells: [],
      misses: [{ x, y }],
    };
  }
  const ship = board.ships[cell.shipId];
  ship.hits += 1;
  if (ship.hits < ship.len) {
    return { x, y, hit: true, sunk: false, win: false, len: ship.len, sunkCells: [], misses: [] };
  }
  ship.sunk = true;
  const misses = [];
  for (const part of ship.cells) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = part.x + dx;
        const ny = part.y + dy;
        if (!inside(nx, ny)) continue;
        const near = board.cells[ny][nx];
        if (near.shipId || near.shot) continue;
        near.shot = true;
        misses.push({ x: nx, y: ny });
      }
    }
  }
  const win = Object.values(board.ships).length > 0 && Object.values(board.ships).every((item) => item.sunk);
  return {
    x,
    y,
    hit: true,
    sunk: true,
    win,
    len: ship.len,
    sunkCells: ship.cells.map((part) => ({ x: part.x, y: part.y })),
    misses,
  };
}

export function applyFog(fog, result) {
  if (result.hit) fog[result.y][result.x] = "hit";
  for (const cell of result.sunkCells || []) fog[cell.y][cell.x] = "sunk";
  for (const cell of result.misses || []) {
    if (fog[cell.y][cell.x] === "unknown") fog[cell.y][cell.x] = "miss";
  }
  if (!result.hit) fog[result.y][result.x] = "miss";
}

export function sunkShips(board) {
  return Object.values(board.ships).filter((ship) => ship.sunk).length;
}

export function wrecksFromFog(fog) {
  const seen = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const wrecks = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (fog[y][x] !== "sunk" || seen[y][x]) continue;
      const cells = [];
      const stack = [[x, y]];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push({ x: cx, y: cy });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inside(nx, ny) || seen[ny][nx] || fog[ny][nx] !== "sunk") continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      const xs = cells.map((cell) => cell.x);
      const ys = cells.map((cell) => cell.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const dir = Math.max(...xs) > minX ? "h" : "v";
      wrecks.push({ x: minX, y: minY, len: cells.length, dir });
    }
  }
  return wrecks;
}
