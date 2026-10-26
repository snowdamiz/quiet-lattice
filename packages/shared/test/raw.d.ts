// Vite's ?raw imports, used by the data suite to read docs/DESIGN.md and the det suite to read math/det.ts without Node
// APIs.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
declare module '*.ts?raw' {
  const text: string;
  export default text;
}
