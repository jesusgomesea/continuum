// Ensina o TypeScript que importar um .module.css devolve os nomes das classes,
// e que importar um .css comum só aplica o estilo.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
declare module '*.css';
