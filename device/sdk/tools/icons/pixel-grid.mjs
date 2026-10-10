/** Recover the original pixel grid from Streamline's rounded 32-unit SVG export.
 * Parse absolute vertices before snapping: rounding relative deltas accumulates errors.
 * This deliberately supports only the orthogonal path vocabulary in this collection.
 */
export function orthogonalPaths(body) {
  const paths = [
    ...body.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?\s*>/g),
  ].map((match) => {
    const tokens =
      match[1].match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    let x = 0,
      y = 0,
      startX = 0,
      startY = 0,
      command;
    const vertices = [];
    for (let i = 0; i < tokens.length;) {
      if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
      const relative = command === command?.toLowerCase();
      const op = command?.toUpperCase();
      if (op === "Z") {
        vertices.push({ op: "Z", x: startX, y: startY });
        x = startX;
        y = startY;
        command = undefined;
        continue;
      }
      const number = () => {
        const value = Number(tokens[i++]);
        if (!Number.isFinite(value)) throw new Error("Invalid SVG coordinate");
        return value;
      };
      if (op === "M") {
        x = (relative ? x : 0) + number();
        y = (relative ? y : 0) + number();
        startX = x;
        startY = y;
        vertices.push({ op: "M", x, y });
        command = relative ? "l" : "L";
      } else if (op === "H") x = (relative ? x : 0) + number();
      else if (op === "V") y = (relative ? y : 0) + number();
      else if (op === "L") {
        x = (relative ? x : 0) + number();
        y = (relative ? y : 0) + number();
      } else throw new Error(`Unsupported pixel path command: ${command}`);
      if (op !== "M") vertices.push({ op: "L", x, y });
    }
    return vertices;
  });
  if (!paths.length) throw new Error("Missing pixel paths");
  return paths;
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
  return {
    width,
    height,
    body: paths
      .map(
        (path) =>
          `<path fill="currentColor" d="${path.map((p) => (p.op === "Z" ? "Z" : `${p.op}${snap(p.x, "x") - minX} ${snap(p.y, "y") - minY}`)).join("")}"/>`,
      )
      .join(""),
  };
}
