/** Build-time compiler API: TSX scene → DUI bytecode, plus deterministic file output. */
export { compileScreen } from "../runtime/jsx-runtime";
export { encodeScene } from "./encode";
export { pack } from "./pack";
export { deflate } from "./deflate";
export { rustScreenManifest, writeIfChanged } from "./output";
