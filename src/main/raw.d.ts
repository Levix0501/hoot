/** A text file, imported as its text, as Vite gives it with `?raw`. */
declare module '*.md?raw' {
  const text: string
  export default text
}
