// Ensina o TypeScript que importar um arquivo com "?raw" (recurso do Vite) devolve o texto dele.
declare module '*?raw' {
  const texto: string;
  export default texto;
}
