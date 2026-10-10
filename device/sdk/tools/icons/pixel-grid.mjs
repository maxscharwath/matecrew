/** Recover the original pixel grid from Streamline's rounded 32-unit SVG export.
 * Parse absolute vertices before snapping: rounding relative deltas accumulates errors.
 * This deliberately supports only the orthogonal path vocabulary in this collection.
 */
export function orthogonalPaths(body) {
  const paths = pathData(body).map(pathVertices);
  if (!paths.length) throw new Error("Missing pixel paths");
  return paths;
}

/** The `d` attribute of every `<path>` element (the last one, should a tag repeat it). */
function pathData(body) {
  const data = [];
  for (const [, attributes] of body.matchAll(/<path\b([^>]*)>/g)) {
    const d = [...attributes.matchAll(/\bd="([^"]+)"/g)].at(-1);
    if (d) data.push(d[1]);
  }
  return data;
}

const isDigit = (s, i) => i < s.length && s[i] >= "0" && s[i] <= "9";
const isLetter = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

function digitsEnd(s, i) {
  let end = i;
  while (isDigit(s, end)) end++;
  return end;
}

/** End of an exponent (`e` or `E`, an optional sign, digits) at `i`, or `i` if there is none. */
function exponentEnd(s, i) {
  if (s[i] !== "e" && s[i] !== "E") return i;
  const digits = s[i + 1] === "-" || s[i + 1] === "+" ? i + 2 : i + 1;
  return isDigit(s, digits) ? digitsEnd(s, digits) : i;
}

/** End of the number at `i` (`+1`, `-.5`, `1.5E3`; `1.` is just 1), or `i` if none starts there. */
function numberEnd(s, i) {
  const start = s[i] === "-" || s[i] === "+" ? i + 1 : i;
  const whole = digitsEnd(s, start);
  let end;
  if (s[whole] === "." && isDigit(s, whole + 1)) end = digitsEnd(s, whole + 1);
  else if (whole > start) end = whole;
  else return i;
  return exponentEnd(s, end);
}

/** Path data to command letters and numbers; anything else separates them. */
function pathTokens(d) {
  const tokens = [];
  let i = 0;
  while (i < d.length) {
    const end = isLetter(d[i]) ? i + 1 : numberEnd(d, i);
    if (end > i) tokens.push(d.slice(i, end));
    i = Math.max(end, i + 1);
  }
  return tokens;
}

/** Absolute vertices of one path: M, L, H, V and Z, absolute or relative. */
function pathVertices(d) {
  const tokens = pathTokens(d);
  const pen = { x: 0, y: 0, startX: 0, startY: 0, i: 0 };
  const vertices = [];
  let command;
  while (pen.i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[pen.i])) command = tokens[pen.i++];
    command = applyCommand(command, tokens, pen, vertices);
  }
  return vertices;
}

/** One command's arguments, read at `pen.i`. Returns the command that takes the next arguments. */
function applyCommand(command, tokens, pen, vertices) {
  const relative = command === command?.toLowerCase();
  const op = command?.toUpperCase();
  if (op === "Z") {
    vertices.push({ op: "Z", x: pen.startX, y: pen.startY });
    pen.x = pen.startX;
    pen.y = pen.startY;
    return undefined;
  }
  const number = () => {
    const value = Number(tokens[pen.i++]);
    if (!Number.isFinite(value)) throw new Error("Invalid SVG coordinate");
    return value;
  };
  const ox = relative ? pen.x : 0;
  const oy = relative ? pen.y : 0;
  if (op === "M") {
    pen.x = ox + number();
    pen.y = oy + number();
    pen.startX = pen.x;
    pen.startY = pen.y;
    vertices.push({ op: "M", x: pen.x, y: pen.y });
    return relative ? "l" : "L";
  }
  if (op === "H") pen.x = ox + number();
  else if (op === "V") pen.y = oy + number();
  else if (op === "L") {
    pen.x = ox + number();
    pen.y = oy + number();
  } else throw new Error(`Unsupported pixel path command: ${command}`);
  vertices.push({ op: "L", x: pen.x, y: pen.y });
  return command;
}

export function pixelGrid(body) {
  const paths = orthogonalPaths(body);
  const points = paths.flat();
  // A half-cell translation is common in centred artwork. Remove it uniformly,
  // preserving one-pixel strokes instead of rounding each edge independently.
  const phase = (axis) => {
    const angles = points.map(
      (point) => ((point[axis] * 21) / 32) * Math.PI * 2,
    );
    return (
      Math.atan2(
        angles.reduce((n, a) => n + Math.sin(a), 0),
        angles.reduce((n, a) => n + Math.cos(a), 0),
      ) /
      (Math.PI * 2)
    );
  };
  const offsets = { x: phase("x"), y: phase("y") };
  const snap = (value, axis) => Math.round((value * 21) / 32 - offsets[axis]);
  const coordinates = points.map((point) => ({
    x: snap(point.x, "x"),
    y: snap(point.y, "y"),
  }));
  const minX = Math.min(0, ...coordinates.map((p) => p.x));
  const minY = Math.min(0, ...coordinates.map((p) => p.y));
  const width = Math.max(21, ...coordinates.map((p) => p.x)) - minX;
  const height = Math.max(21, ...coordinates.map((p) => p.y)) - minY;
  const vertex = (p) => (p.op === "Z" ? "Z" : `${p.op}${snap(p.x, "x") - minX} ${snap(p.y, "y") - minY}`);
  return {
    width,
    height,
    body: paths.map((path) => `<path fill="currentColor" d="${path.map(vertex).join("")}"/>`).join(""),
  };
}
