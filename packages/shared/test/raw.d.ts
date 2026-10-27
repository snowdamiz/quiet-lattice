// Vite's ?raw imports, used by the data suite to read docs/DESIGN.md, the det suite to read math/det.ts and the movement
// suite to read the client's walker, ship and game sources, without Node APIs.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
declare module '*.ts?raw' {
  const text: string;
  export default text;
}
declare module '*.js?raw' {
  const text: string;
  export default text;
}
