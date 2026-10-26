// Vite's ?raw imports, used by the data suite to read docs/DESIGN.md without Node APIs.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
